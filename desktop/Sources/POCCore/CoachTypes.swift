import Foundation

/// The shapes that cross between Swift and the shared coaching JavaScript (extension/src/coach.js).
/// Field names match the JSON the engine returns.

public enum Reader: String, Codable, Equatable { case ai, person }

public struct CoachQuestion: Codable, Equatable, Identifiable {
    public let id: String
    /// The words of the draft this question is about, or "".
    public let quote: String
    public let question: String
    public let options: [String]
    public init(id: String, quote: String = "", question: String, options: [String]) {
        self.id = id; self.quote = quote; self.question = question; self.options = options
    }
}

public struct Diagnosis: Equatable {
    public let reader: Reader
    public let questions: [CoachQuestion]
    public init(reader: Reader, questions: [CoachQuestion]) { self.reader = reader; self.questions = questions }
}

public struct Answer: Equatable, Codable {
    public let question: String
    /// nil = skipped.
    public let answer: String?
    public init(question: String, answer: String?) { self.question = question; self.answer = answer }
}

public struct RewriteResult: Equatable {
    /// The rewritten text: exactly what gets pasted back.
    public let prompt: String
    /// Labels of the techniques the rewrite applies ("Clear deliverable", …).
    public let techniques: [String]
    /// Checks the rewrite still fails after its one retry. Non-empty = say so, don't pass it off as clean.
    public let unverified: [String]
    public init(prompt: String, techniques: [String] = [], unverified: [String] = []) {
        self.prompt = prompt; self.techniques = techniques; self.unverified = unverified
    }
}

/// A failure the card can explain. `code` is the stable part (same codes as extension/src/llm.js).
public struct CoachFailure: Error, Equatable {
    public let code: String
    public let message: String
    public init(code: String, message: String) { self.code = code; self.message = message }

    /// Errors the settings dialog can fix; the rest get "Try again".
    public var needsSettings: Bool {
        ["no-key", "no-model", "local-down", "bad-key", "bad-model", "forbidden"].contains(code)
    }
    /// Stopped on purpose (the card was closed); nothing to show.
    public var isCancellation: Bool { code == "cancelled" }
}

/// Which model to talk to. Provider, model and base URL are settings; the key is a secret
/// (Keychain) and is handed over for one call at a time.
public struct CoachConfig: Equatable, CustomStringConvertible {
    public var provider: String
    public var model: String
    public var apiKey: String
    public var baseUrl: String
    public var timeoutSeconds: Double
    public init(provider: String, model: String = "", apiKey: String = "", baseUrl: String = "", timeoutSeconds: Double = 90) {
        self.provider = provider; self.model = model; self.apiKey = apiKey; self.baseUrl = baseUrl; self.timeoutSeconds = timeoutSeconds
    }
    /// Never prints the key, so a stray log line cannot leak it.
    public var description: String { "CoachConfig(\(provider), model: \(model.isEmpty ? "auto" : model), key: \(apiKey.isEmpty ? "none" : "set"))" }
}

/// The seam to the model. The real one runs the extension's JS in a web view (POCEngine);
/// tests use a scripted fake.
public protocol CoachEngine: AnyObject {
    func diagnose(config: CoachConfig, draft: String, host: String) async -> Result<Diagnosis, CoachFailure>
    func rewrite(config: CoachConfig, draft: String, answers: [Answer], reader: Reader, host: String,
                 onPartial: @escaping @Sendable (String) -> Void) async -> Result<RewriteResult, CoachFailure>
    /// Stop whatever is running.
    func cancel()
}
