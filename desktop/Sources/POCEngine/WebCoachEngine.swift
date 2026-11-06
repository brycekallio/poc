import Foundation
import WebKit
import POCCore

/// Runs the extension's own coaching code (extension/src/desktop.js → Resources/web/engine.js) in a
/// hidden web view, so the prompts, schemas, providers and rewrite checks are the same as Chrome's.
/// Swift hands over the config (key included) for one call and gets plain data back; the page loads
/// only our bundled file (its Content-Security-Policy allows no other script).
@MainActor
public final class WebCoachEngine: NSObject, CoachEngine, WKNavigationDelegate {
    private let webView: WKWebView
    private let directory: URL
    private var loaded = false
    private var loadWaiters: [CheckedContinuation<Bool, Never>] = []
    private var partials: [String: @Sendable (String) -> Void] = [:]
    private var current = 0

    /// `directory` holds index.html and engine.js (the app's Resources/web, or desktop/Resources/web in a checkout).
    public init(directory: URL) {
        self.directory = directory
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()   // nothing the page does is written to disk
        // Served from app://poc, not file://: a file page sends "Origin: null", which Ollama refuses
        // (403), while it trusts app:// by default. Same reason the extension strips Chrome's Origin.
        config.setURLSchemeHandler(BundleSchemeHandler(directory: directory), forURLScheme: "app")
        config.userContentController.addScriptMessageHandler(NativeFetch(), contentWorld: .page, name: "net")
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        config.userContentController.add(WeakHandler(self), name: "poc")
        webView.navigationDelegate = self
        webView.load(URLRequest(url: Self.pageURL))
    }

    private static let pageURL = URL(string: "app://poc/index.html")!

    // MARK: CoachEngine

    nonisolated public func diagnose(config: CoachConfig, draft: String, host: String) async -> Result<Diagnosis, CoachFailure> {
        let reply = await call("diagnose", args: ["config": Self.json(config), "draft": draft, "host": host, "timeoutMs": config.timeoutSeconds * 1000])
        return reply.flatMap { r in
            guard let reader = (r["reader"] as? String).flatMap(Reader.init(rawValue:)),
                  let raw = r["questions"] as? [[String: Any]] else { return .failure(Self.malformed) }
            let questions = raw.compactMap { q -> CoachQuestion? in
                guard let id = q["id"] as? String, let text = q["question"] as? String, let options = q["options"] as? [String] else { return nil }
                return CoachQuestion(id: id, quote: q["quote"] as? String ?? "", question: text, options: options)
            }
            return .success(Diagnosis(reader: reader, questions: questions))
        }
    }

    nonisolated public func rewrite(config: CoachConfig, draft: String, answers: [Answer], reader: Reader, host: String,
                                    onPartial: @escaping @Sendable (String) -> Void) async -> Result<RewriteResult, CoachFailure> {
        let id = UUID().uuidString
        await register(id, onPartial)
        let args: [String: Any] = [
            "config": Self.json(config), "draft": draft, "host": host, "reader": reader.rawValue, "timeoutMs": config.timeoutSeconds * 1000,
            "answers": answers.map { ["question": $0.question, "answer": $0.answer.map { $0 as Any } ?? NSNull()] },
        ]
        let reply = await call("rewrite", args: args, callId: id)
        await register(id, nil)
        return reply.flatMap { r in
            guard let prompt = r["prompt"] as? String else { return .failure(Self.malformed) }
            return .success(RewriteResult(prompt: prompt, techniques: r["techniques"] as? [String] ?? [], unverified: r["unverified"] as? [String] ?? []))
        }
    }

    nonisolated public func cancel() {
        Task { @MainActor in
            guard self.loaded else { return }
            _ = try? await self.webView.callAsyncJavaScript("poc.cancel()", arguments: [:], in: nil, contentWorld: .page)
        }
    }

    // MARK: Plumbing

    nonisolated private static let malformed = CoachFailure(code: "unparseable", message: "The response came back malformed. Try again, or pick a stronger model in Settings.")

    private func register(_ id: String, _ handler: (@Sendable (String) -> Void)?) { partials[id] = handler }

    /// Calls `poc.<name>(args, callId)` in the page and unpacks `{ ok, ... }`.
    private func call(_ name: String, args: [String: Any], callId: String = "") async -> Result<[String: Any], CoachFailure> {
        guard await ensureLoaded() else {
            return .failure(CoachFailure(code: "engine", message: "POC's coaching engine could not start. Reinstall the app."))
        }
        do {
            let raw = try await webView.callAsyncJavaScript(
                "return await poc.\(name)(args, callId)", arguments: ["args": args, "callId": callId], in: nil, contentWorld: .page)
            guard let reply = raw as? [String: Any] else { return .failure(Self.malformed) }
            if reply["ok"] as? Bool == true { return .success(reply) }
            let e = reply["error"] as? [String: Any]
            let key = (args["config"] as? [String: Any])?["apiKey"] as? String
            return .failure(CoachFailure(code: e?["code"] as? String ?? "unknown", message: e?["message"] as? String ?? "Something went wrong.")
                .redacting(key))
        } catch {
            return .failure(CoachFailure(code: "engine", message: "POC's coaching engine stopped. Try again."))
        }
    }

    private func ensureLoaded() async -> Bool {
        if loaded { return true }
        return await withCheckedContinuation { loadWaiters.append($0) }
    }

    private func finishLoad(_ ok: Bool) {
        loaded = ok
        let waiters = loadWaiters; loadWaiters = []
        for w in waiters { w.resume(returning: ok) }
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finishLoad(true) }
    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finishLoad(false) }
    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finishLoad(false) }
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The page's process died (memory pressure): start it again for the next call.
        loaded = false
        webView.load(URLRequest(url: Self.pageURL))
    }

    nonisolated fileprivate func deliver(_ body: Any) {
        guard let m = body as? [String: Any], m["type"] as? String == "partial",
              let id = m["callId"] as? String, let text = m["text"] as? String else { return }
        Task { @MainActor in self.partials[id]?(text) }
    }

    nonisolated private static func json(_ c: CoachConfig) -> [String: Any] {
        ["provider": c.provider, "model": c.model, "apiKey": c.apiKey, "baseUrl": c.baseUrl]
    }
}

/// WKUserContentController retains its handler; a weak hop keeps the engine freeable.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WebCoachEngine?
    init(_ t: WebCoachEngine) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        Task { @MainActor in self.target?.deliver(body) }
    }
}

/// Serves the bundled engine files to the page at app://poc/<name>. Only files directly inside the
/// bundled folder; anything else is a 404.
private final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    let directory: URL
    init(directory: URL) { self.directory = directory }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let name = task.request.url?.lastPathComponent ?? ""
        let file = directory.appendingPathComponent(name)
        guard !name.isEmpty, !name.contains("/"), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let type = file.pathExtension == "js" ? "text/javascript" : file.pathExtension == "html" ? "text/html" : "application/octet-stream"
        let response = HTTPURLResponse(url: task.request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": type + "; charset=utf-8", "Content-Length": "\(data.count)"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// The page's `webkit.messageHandlers.net`: a fetch done by URLSession for providers whose servers send no
/// CORS headers on the real reply (api.openai.com, see desktop/CORS.md), which a web view cannot read.
/// Not a proxy: https and the hosts below only, anything else is refused. The key rides in the request
/// headers from the page; nothing here stores or logs a request.
final class NativeFetch: NSObject, WKScriptMessageHandlerWithReply {
    static let hosts: Set<String> = ["api.openai.com"]   // keep in sync with NATIVE_HOSTS in extension/src/desktop.js

    static func allows(_ url: URL?) -> Bool {
        guard let url, url.scheme == "https", url.port == nil, url.user == nil, let host = url.host?.lowercased() else { return false }
        return hosts.contains(host)
    }

    private let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil; c.urlCache = nil
        return URLSession(configuration: c)
    }()

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let m = message.body as? [String: Any], let s = m["url"] as? String, let url = URL(string: s), Self.allows(url) else {
            replyHandler(["error": "refused"], nil); return
        }
        var req = URLRequest(url: url)
        req.httpMethod = (m["method"] as? String) ?? "GET"
        for (k, v) in (m["headers"] as? [String: String]) ?? [:] { req.setValue(v, forHTTPHeaderField: k) }
        if let body = m["body"] as? String { req.httpBody = Data(body.utf8) }
        let session = self.session
        Task {
            do {
                let (data, response) = try await session.data(for: req)
                guard let http = response as? HTTPURLResponse else { await replyHandler(["error": "network"], nil); return }
                var headers: [String: String] = [:]
                for (k, v) in http.allHeaderFields { if let k = k as? String, let v = v as? String { headers[k] = v } }
                await replyHandler(["status": http.statusCode, "headers": headers, "body": String(decoding: data, as: UTF8.self)], nil)
            } catch {
                await replyHandler(["error": "network"], nil)
            }
        }
    }
}
