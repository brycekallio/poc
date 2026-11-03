import AppKit
import POCCore
import POCEngine

// Headless check of the real coach: loads the bundled JS in a hidden web view, runs both model
// calls (questions, then rewrite) against the configured model, and prints what came back and how
// long each step took. Touches no other app, the clipboard or the Keychain.
//
//   swift run POCHarness --provider ollama --model qwen2.5:latest --runs 3
//   POC_API_KEY=… swift run POCHarness --provider anthropic --model claude-sonnet-5-5
//
// Flags: --draft "…" --provider id --model id --base-url url --runs n --web <dir with engine.js>
//        --pick first|last (which option to answer with)  --timeout seconds
var args = Array(CommandLine.arguments.dropFirst())
func flag(_ name: String, _ fallback: String) -> String {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return fallback }
    let v = args[i + 1]; args.removeSubrange(i...(i + 1)); return v
}
let draft = flag("--draft", "write a summary of the q3 report for the team, make it good and not too long")
let provider = flag("--provider", "ollama")
let model = flag("--model", "")
let baseUrl = flag("--base-url", "")
let runs = Int(flag("--runs", "1")) ?? 1
let web = flag("--web", FileManager.default.currentDirectoryPath + "/Resources/web")
let pick = flag("--pick", "first")
let timeout = Double(flag("--timeout", "90")) ?? 90
let config = CoachConfig(provider: provider, model: model, apiKey: ProcessInfo.processInfo.environment["POC_API_KEY"] ?? "", baseUrl: baseUrl, timeoutSeconds: timeout)
let host = HostLabel.label(forApp: "Claude")

@MainActor func harness() async -> Int32 {
    let engine = WebCoachEngine(directory: URL(fileURLWithPath: web))
    print("engine \(web)\nconfig \(config)\ndraft: \(draft)\n")
    var totals: [(Double, Double, Double?)] = []
    for run in 1...runs {
        let t0 = Date()
        switch await engine.diagnose(config: config, draft: draft, host: host) {
        case let .failure(f): print("call 1 FAILED [\(f.code)] \(f.message)"); return 1
        case let .success(d):
            let c1 = Date().timeIntervalSince(t0)
            print("run \(run) · call 1: \(String(format: "%.1f", c1)) s · reader \(d.reader.rawValue) · \(d.questions.count) question(s)")
            for q in d.questions { print("   ? \(q.question)  [\(q.options.joined(separator: " | "))]") }
            let answers = d.questions.map { Answer(question: $0.question, answer: pick == "last" ? $0.options.last : $0.options.first) }
            let t1 = Date()
            let first = FirstWords()
            let result = await engine.rewrite(config: config, draft: draft, answers: answers, reader: d.reader, host: host) { text in
                if !text.isEmpty { first.mark(since: t1) }
            }
            switch result {
            case let .failure(f): print("call 2 FAILED [\(f.code)] \(f.message)"); return 1
            case let .success(r):
                let c2 = Date().timeIntervalSince(t1)
                totals.append((c1, c2, first.seconds))
                print("   call 2: \(String(format: "%.1f", c2)) s" + (first.seconds.map { " (first words after \(String(format: "%.1f", $0)) s)" } ?? "")
                      + (r.unverified.isEmpty ? "" : " · checks failed: \(r.unverified.count)"))
                print("   techniques: \(r.techniques.joined(separator: ", "))")
                print("   rewrite: \(r.prompt)\n")
            }
        }
    }
    func median(_ xs: [Double]) -> Double { xs.sorted()[xs.count / 2] }
    let m1 = median(totals.map { $0.0 }), m2 = median(totals.map { $0.1 })
    print(String(format: "median: call 1 %.1f s · call 2 %.1f s · whole use %.1f s (%d run%@)", m1, m2, m1 + m2, totals.count, totals.count == 1 ? "" : "s"))
    return 0
}

/// First streamed text of the rewrite; written from the engine's callback queue, read after the call.
final class FirstWords: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Double?
    func mark(since t: Date) { lock.lock(); if value == nil { value = Date().timeIntervalSince(t) }; lock.unlock() }
    var seconds: Double? { lock.lock(); defer { lock.unlock() }; return value }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)   // no Dock icon, no window, never frontmost
Task { @MainActor in exit(await harness()) }
app.run()
