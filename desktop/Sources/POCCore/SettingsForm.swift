import Foundation

/// The logic behind the Settings window, with no UI so `swift test` covers it: what the form
/// holds, what is wrong with it, and the config a "Test" press should use. The typed key lives
/// only in this value until Save hands it to the Keychain; it is never printed.
public struct SettingsForm: Equatable {
    public enum Problem: Equatable {
        case needsKey          // hosted provider, nothing typed and nothing saved
        case needsAddress      // "Other" server without an address
        case badAddress        // address is not http(s)://host
    }

    public var provider: String
    /// Empty = automatic (the engine picks the first model the server lists).
    public var model: String
    public var baseUrl: String
    /// Typed this session. Empty with a saved key = keep the saved one.
    public var typedKey: String
    public var hasSavedKey: Bool

    public init(provider: String, model: String = "", baseUrl: String = "", typedKey: String = "", hasSavedKey: Bool = false) {
        self.provider = provider; self.model = model; self.baseUrl = baseUrl
        self.typedKey = typedKey; self.hasSavedKey = hasSavedKey
    }

    public var info: CoachSettings.Provider? { CoachSettings.providers.first { $0.id == provider } }
    public var needsKey: Bool { info?.needsKey ?? false }
    public var usesBaseUrl: Bool { info?.usesBaseUrl ?? false }
    /// Ollama can pick its own model; hosted providers have a built-in default in the engine, so blank is fine everywhere.
    public var canBeAutomatic: Bool { provider == "ollama" || provider == "custom" }

    static func clean(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
    public var cleanKey: String { Self.clean(typedKey) }
    public var cleanModel: String { Self.clean(model) }
    public var cleanBaseUrl: String { Self.clean(baseUrl) }

    public var problems: [Problem] {
        var out: [Problem] = []
        if needsKey, cleanKey.isEmpty, !hasSavedKey { out.append(.needsKey) }
        if usesBaseUrl {
            if cleanBaseUrl.isEmpty { out.append(.needsAddress) }
            else if !Self.isHttpAddress(cleanBaseUrl) { out.append(.badAddress) }
        }
        return out
    }
    public var isValid: Bool { problems.isEmpty }

    public static func isHttpAddress(_ s: String) -> Bool {
        guard let u = URL(string: s), let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return false }
        return !(u.host ?? "").isEmpty
    }

    public static func message(for p: Problem) -> String {
        switch p {
        case .needsKey: return "Paste your API key for this provider."
        case .needsAddress: return "Enter the server address, for example http://localhost:1234/v1."
        case .badAddress: return "The address must start with http:// or https://."
        }
    }

    /// What one call should use. `savedKey` is read from the Keychain by the caller only when nothing was typed.
    public func config(savedKey: String, timeoutSeconds: Double = 90) -> CoachConfig {
        CoachConfig(provider: provider, model: cleanModel, apiKey: needsKey ? (cleanKey.isEmpty ? savedKey : cleanKey) : "",
                    baseUrl: usesBaseUrl ? cleanBaseUrl : "", timeoutSeconds: timeoutSeconds)
    }

    /// Load the form from stored settings.
    public static func load(from settings: CoachSettings, provider: String? = nil) -> SettingsForm {
        let p = provider ?? settings.provider
        return SettingsForm(provider: p, model: settings.model(for: p), baseUrl: settings.baseUrl,
                            typedKey: "", hasSavedKey: !settings.key(for: p).isEmpty)
    }

    /// Write the form to stored settings. Throws only if the Keychain refuses; a blank typed key keeps the saved one.
    public func save(to settings: CoachSettings) throws {
        guard isValid else { return }
        settings.provider = provider
        settings.setModel(cleanModel, for: provider)
        if usesBaseUrl { settings.baseUrl = cleanBaseUrl }
        if needsKey, !cleanKey.isEmpty { try settings.setKey(cleanKey, for: provider) }
    }

    /// A short, safe line for the Test button's outcome. Never contains the key.
    public static func testSummary(_ result: Result<Int, CoachFailure>) -> String {
        switch result {
        case .success: return "Connected. The model answered."
        case let .failure(f): return f.message.isEmpty ? "The test failed (\(f.code))." : f.message
        }
    }
}

/// What the home window says about POC itself.
public enum HomeStatus {
    public static func accessibilityLine(granted: Bool) -> String {
        granted ? "Accessibility is on. POC can read your selection and paste the rewrite back."
                : "Accessibility is off. POC can't read your selection or paste back until you switch it on."
    }
    /// Reopen from Finder / `open` shows the window; a self-test must never.
    public static func shouldShowWindow(selfTest: String?) -> Bool { (selfTest ?? "").isEmpty }
}
