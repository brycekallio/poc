import XCTest
import Network
@testable import POCCore
@testable import POCEngine

/// A tiny local HTTP server standing in for the model, so the real bundled JavaScript runs in a real
/// web view with no network and no key. `respond` returns the reply for a request, or nil to hang.
final class StubModelServer: @unchecked Sendable {
    struct Request { let method: String; let path: String; let origin: String?; let authorization: String?; let body: Data }
    private let listener: NWListener
    private let queue = DispatchQueue(label: "stub-model-server")
    private let lock = NSLock()
    private var _requests: [Request] = []
    private let respond: @Sendable (Request) -> (status: Int, type: String, body: String)?
    private(set) var port: UInt16 = 0

    init(respond: @escaping @Sendable (Request) -> (status: Int, type: String, body: String)?) throws {
        self.respond = respond
        listener = try NWListener(using: .tcp, on: .any)
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { [weak self] state in
            if case .ready = state { self?.port = self?.listener.port?.rawValue ?? 0; ready.signal() }
        }
        listener.newConnectionHandler = { [weak self] c in self?.serve(c) }
        listener.start(queue: queue)
        _ = ready.wait(timeout: .now() + 5)
    }
    deinit { listener.cancel() }
    var baseUrl: String { "http://127.0.0.1:\(port)/v1" }
    var requests: [Request] { lock.lock(); defer { lock.unlock() }; return _requests }

    private func serve(_ c: NWConnection) {
        c.start(queue: queue)
        var buffer = Data()
        func readMore() {
            c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { [weak self] data, _, done, error in
                guard let self else { return }
                if let data { buffer.append(data) }
                if let req = Self.parse(buffer) {
                    self.lock.lock(); self._requests.append(req); self.lock.unlock()
                    if req.method == "OPTIONS" { return self.send(c, 204, "text/plain", "") }
                    if let r = self.respond(req) { self.send(c, r.status, r.type, r.body) }   // nil = never answer
                } else if error == nil, !done { readMore() }
            }
        }
        readMore()
    }

    private func send(_ c: NWConnection, _ status: Int, _ type: String, _ body: String) {
        let head = "HTTP/1.1 \(status) X\r\nContent-Type: \(type)\r\nContent-Length: \(body.utf8.count)\r\n"
            + "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Allow-Methods: *\r\nConnection: close\r\n\r\n"
        c.send(content: Data((head + body).utf8), completion: .contentProcessed { _ in c.cancel() })
    }

    private static func parse(_ data: Data) -> Request? {
        guard let split = data.range(of: Data("\r\n\r\n".utf8)),
              let head = String(data: data[..<split.lowerBound], encoding: .utf8) else { return nil }
        let lines = head.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ")
        guard first.count >= 2 else { return nil }
        func header(_ n: String) -> String? { lines.dropFirst().first { $0.lowercased().hasPrefix(n + ":") }.map { String($0.dropFirst(n.count + 1)).trimmingCharacters(in: .whitespaces) } }
        let length = Int(header("content-length") ?? "0") ?? 0
        let body = data[split.upperBound...]
        guard body.count >= length else { return nil }
        return Request(method: String(first[0]), path: String(first[1]), origin: header("origin"), authorization: header("authorization"), body: Data(body.prefix(length)))
    }
}

private func chat(_ object: [String: Any]) -> String {
    let content = String(data: try! JSONSerialization.data(withJSONObject: object), encoding: .utf8)!
    let reply: [String: Any] = ["choices": [["message": ["content": content], "finish_reason": "stop"]]]
    return String(data: try! JSONSerialization.data(withJSONObject: reply), encoding: .utf8)!
}
private let diagnosis: [String: Any] = [
    "reader": "ai", "diagnosis": ["no length"],
    "questions": [["id": "length", "quote": "summary", "question": "How long?", "options": ["One page", "Three bullets"]]],
]
private let rewrite: [String: Any] = [
    "prompt": "Write a one-page summary of the Q3 report for the team.",
    "techniques": [["id": "deliverable", "evidence": "one-page summary"]],
]

/// The bundled engine.js is built by `npm run build` in extension/ (verify.sh does it first).
private let web = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("Resources/web")

@MainActor
final class WebEngineTests: XCTestCase {
    private func engine() throws -> WebCoachEngine {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: web.appendingPathComponent("engine.js").path),
                          "engine.js missing: run `npm run build` in extension/")
        return WebCoachEngine(directory: web)
    }
    private func config(_ server: StubModelServer, timeout: Double = 20) -> CoachConfig {
        CoachConfig(provider: "custom", model: "stub-model", baseUrl: server.baseUrl, timeoutSeconds: timeout)
    }

    func testCallOneReturnsTheQuestionsFromTheSharedCoachCode() async throws {
        let server = try StubModelServer { _ in (200, "application/json", chat(diagnosis)) }
        let result = await try engine().diagnose(config: config(server), draft: "write a summary of the q3 report", host: "Claude, an AI chat app")
        let d = try result.get()
        XCTAssertEqual(d.reader, .ai)
        XCTAssertEqual(d.questions.first?.question, "How long?")
        XCTAssertEqual(d.questions.first?.options, ["One page", "Three bullets"])
        // The request really is the extension's call 1: a system prompt, the draft fenced as material, a JSON schema.
        let body = String(data: server.requests.first { $0.method == "POST" }!.body, encoding: .utf8)!
        XCTAssertTrue(body.contains("<draft>"))
        XCTAssertTrue(body.contains("Claude, an AI chat app"))
        XCTAssertTrue(body.contains("json_schema"))
        XCTAssertTrue(body.contains("stub-model"))
    }

    func testCallTwoReturnsTheRewriteAndStreamsItsFirstWords() async throws {
        let json = String(data: try JSONSerialization.data(withJSONObject: rewrite), encoding: .utf8)!
        func sse(_ piece: String) -> String {
            "data: " + String(data: try! JSONSerialization.data(withJSONObject: ["choices": [["delta": ["content": piece]]]]), encoding: .utf8)! + "\n\n"
        }
        let stream = sse(String(json.prefix(35))) + sse(String(json.dropFirst(35)))
            + "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
        let server = try StubModelServer { _ in (200, "text/event-stream", stream) }
        let partials = PartialLog()
        let result = await try engine().rewrite(
            config: config(server), draft: "write a summary of the q3 report", answers: [Answer(question: "How long?", answer: "One page"), Answer(question: "For whom?", answer: nil)],
            reader: .ai, host: "Claude, an AI chat app", onPartial: { partials.add($0) })
        let r = try result.get()
        XCTAssertEqual(r.prompt, "Write a one-page summary of the Q3 report for the team.")
        XCTAssertEqual(r.techniques, ["Clear deliverable"])
        XCTAssertEqual(r.unverified, [])
        try await Task.sleep(nanoseconds: 200_000_000)   // partials hop through the main actor
        XCTAssertTrue(partials.all.contains { $0.hasPrefix("Write a one-page") }, "got \(partials.all)")
        let body = String(data: server.requests.first { $0.method == "POST" }!.body, encoding: .utf8)!
        XCTAssertTrue(body.contains("A: One page"))
        XCTAssertTrue(body.contains("skipped"))
    }

    func testPageIsServedFromAppSchemeSoOllamaWillAcceptIt() async throws {
        let server = try StubModelServer { _ in (200, "application/json", chat(diagnosis)) }
        _ = await try engine().diagnose(config: config(server), draft: "draft", host: "x")
        let origin = server.requests.first { $0.method == "POST" }?.origin
        XCTAssertEqual(origin, "app://poc")   // not "null" (file://), which Ollama answers with 403
    }

    func testNoKeyForAHostedProviderFailsBeforeAnyRequest() async throws {
        let result = await try engine().diagnose(config: CoachConfig(provider: "anthropic", model: "claude-sonnet-5-5"), draft: "draft", host: "x")
        XCTAssertEqual(result, .failure(CoachFailure(code: "no-key", message: "No API key yet.")))
        XCTAssertTrue(CoachFailure(code: "no-key", message: "").needsSettings)
    }

    func testModelErrorsComeBackAsCodesTheCardCanExplain() async throws {
        let missing = try StubModelServer { _ in (404, "text/plain", "no such model") }
        let e = try engine()
        guard case let .failure(f) = await e.diagnose(config: config(missing), draft: "draft", host: "x") else { return XCTFail("expected failure") }
        XCTAssertEqual(f.code, "bad-model")
        let garbage = try StubModelServer { _ in (200, "application/json", chat(["nonsense": true])) }
        guard case let .failure(g) = await e.diagnose(config: config(garbage), draft: "draft", host: "x") else { return XCTFail("expected failure") }
        XCTAssertEqual(g.code, "unparseable")
        XCTAssertFalse(g.needsSettings)   // "Try again", not "Open settings"
    }

    func testServerDownIsANetworkError() async throws {
        let cfg = CoachConfig(provider: "custom", model: "m", baseUrl: "http://127.0.0.1:1/v1", timeoutSeconds: 10)   // nothing listens on port 1
        guard case let .failure(f) = await try engine().diagnose(config: cfg, draft: "draft", host: "x") else { return XCTFail("expected failure") }
        XCTAssertEqual(f.code, "network")
    }

    func testTimeoutStopsWaitingAndSaysSo() async throws {
        let silent = try StubModelServer { _ in nil }   // accepts, never answers
        let started = Date()
        guard case let .failure(f) = await try engine().diagnose(config: config(silent, timeout: 1), draft: "draft", host: "x") else { return XCTFail("expected failure") }
        XCTAssertEqual(f.code, "timeout")
        XCTAssertTrue(f.message.contains("took longer than 1 seconds"))
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
    }

    func testCancelStopsTheCallQuietly() async throws {
        let silent = try StubModelServer { _ in nil }
        let e = try engine()
        let cfg = config(silent)
        async let result = e.diagnose(config: cfg, draft: "draft", host: "x")
        // Cancel only once the request is in flight: a fixed sleep raced the web view's start-up under load.
        let deadline = Date().addingTimeInterval(15)
        while !silent.requests.contains(where: { $0.method == "POST" }) && Date() < deadline {
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        e.cancel()
        guard case let .failure(f) = await result else { return XCTFail("expected failure") }
        XCTAssertTrue(f.isCancellation)
    }

    func testTheKeyIsSentToTheProviderAndNeverComesBack() async throws {
        let server = try StubModelServer { _ in (200, "application/json", chat(diagnosis)) }
        let cfg = CoachConfig(provider: "custom", model: "m", apiKey: "sk-test-secret", baseUrl: server.baseUrl)
        let reply = await try engine().diagnose(config: cfg, draft: "draft", host: "x")
        XCTAssertNoThrow(try reply.get())
        XCTAssertEqual(server.requests.first { $0.method == "POST" }?.authorization, "Bearer sk-test-secret")
        XCTAssertFalse(String(describing: reply).contains("sk-test-secret"))
        XCTAssertFalse(cfg.description.contains("sk-test-secret"))
    }
}

/// Real requests from the web view's origin (app://poc) to each hosted provider, carrying a deliberately
/// invalid key. A 401 the page can read (-> "bad-key") proves the CORS preflight passed; a blocked
/// preflight would surface as "network". No real key, no billable call. Skipped when offline.
@MainActor
final class HostedProviderTests: XCTestCase {
    private static let fake = "sk-invalid-poc-t7"
    private static let web = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Resources/web")

    private func probe(_ config: CoachConfig, host: String) async throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: Self.web.appendingPathComponent("engine.js").path), "engine.js missing")
        var reachable = false
        if let url = URL(string: "https://\(host)/"), let (_, r) = try? await URLSession.shared.data(from: url), r is HTTPURLResponse { reachable = true }
        try XCTSkipUnless(reachable, "offline: cannot reach \(host)")
        let result = await WebCoachEngine(directory: Self.web).diagnose(config: config, draft: "write a summary of the q3 report", host: "Claude, an AI chat app")
        guard case let .failure(f) = result else { return XCTFail("an invalid key must not succeed") }
        XCTAssertEqual(f.code, "bad-key", "\(config.provider): got \(f.code) / \(f.message)")
        XCTAssertTrue(f.needsSettings)
        XCTAssertFalse(f.message.contains(Self.fake))
        XCTAssertFalse(String(describing: f).contains(Self.fake))
    }

    func testAnthropicRejectsABadKeyReadably() async throws {
        try await probe(CoachConfig(provider: "anthropic", model: "claude-sonnet-5-5", apiKey: Self.fake), host: "api.anthropic.com")
    }
    func testOpenAIRejectsABadKeyReadably() async throws {
        try await probe(CoachConfig(provider: "openai", model: "gpt-5-mini", apiKey: Self.fake), host: "api.openai.com")
    }
    func testGeminiRejectsABadKeyReadably() async throws {
        try await probe(CoachConfig(provider: "gemini", model: "gemini-2.5-flash", apiKey: Self.fake), host: "generativelanguage.googleapis.com")
    }
    func testOpenAICompatibleRejectsABadKeyReadably() async throws {
        try await probe(CoachConfig(provider: "custom", model: "llama-3.3-70b-versatile", apiKey: Self.fake, baseUrl: "https://api.groq.com/openai/v1"), host: "api.groq.com")
    }
}

final class PartialLog: @unchecked Sendable {
    private let lock = NSLock(); private var values: [String] = []
    func add(_ s: String) { lock.lock(); values.append(s); lock.unlock() }
    var all: [String] { lock.lock(); defer { lock.unlock() }; return values }
}
