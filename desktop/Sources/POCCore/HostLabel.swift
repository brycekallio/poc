import Foundation

/// How the app the draft came from is described to the model (the `host` of coach.js). A known
/// AI app is named as one, which is what the prompt keys on to treat the draft as a prompt.
public enum HostLabel {
    static let aiApps = ["claude", "chatgpt", "codex", "t3 code", "cursor", "windsurf", "perplexity", "gemini", "copilot", "lm studio", "ollama"]

    public static func label(forApp name: String) -> String {
        let lower = name.lowercased()
        return aiApps.contains { lower.contains($0) } ? "\(name), an AI chat app" : name
    }
}
