import Foundation

/// The model settings. Provider, model, base URL and timeout are not secret and live in
/// UserDefaults; the key lives in the Keychain, one per provider. Defaults to Ollama, like the
/// extension: free, local, no key. Model and provider are config, never constants in code.
public struct CoachSettings {
    public struct Provider: Equatable {
        public let id: String
        public let name: String
        public let needsKey: Bool
        public let usesBaseUrl: Bool
    }
    /// Same ids as extension/src/coach-models.js PROVIDERS (the engine is the judge of what works).
    public static let providers: [Provider] = [
        .init(id: "ollama", name: "Ollama (free, on this Mac)", needsKey: false, usesBaseUrl: false),
        .init(id: "anthropic", name: "Anthropic (Claude)", needsKey: true, usesBaseUrl: false),
        .init(id: "openai", name: "OpenAI", needsKey: true, usesBaseUrl: false),
        .init(id: "gemini", name: "Google Gemini", needsKey: true, usesBaseUrl: false),
        .init(id: "custom", name: "Other (OpenAI-compatible server)", needsKey: false, usesBaseUrl: true),
    ]
    public static let defaultProvider = "ollama"

    private let defaults: UserDefaults
    private let secrets: SecretStore

    public init(defaults: UserDefaults = .standard, secrets: SecretStore = KeychainStore()) {
        self.defaults = defaults; self.secrets = secrets
    }

    public var provider: String {
        get { defaults.string(forKey: "provider") ?? Self.defaultProvider }
        nonmutating set { defaults.set(newValue, forKey: "provider") }
    }
    /// Empty = let the engine pick (a local server's first model).
    public func model(for provider: String) -> String { defaults.string(forKey: "model.\(provider)") ?? "" }
    public func setModel(_ model: String, for provider: String) { defaults.set(model, forKey: "model.\(provider)") }
    public var baseUrl: String {
        get { defaults.string(forKey: "baseUrl") ?? "" }
        nonmutating set { defaults.set(newValue, forKey: "baseUrl") }
    }
    public var timeoutSeconds: Double {
        get { let v = defaults.double(forKey: "timeoutSeconds"); return v > 0 ? v : 90 }
        nonmutating set { defaults.set(newValue, forKey: "timeoutSeconds") }
    }

    public func key(for provider: String) -> String { secrets.secret(for: provider) ?? "" }
    public func setKey(_ key: String, for provider: String) throws { try secrets.setSecret(key, for: provider) }

    /// The config for one call. Reads the key from the Keychain now.
    public func current() -> CoachConfig {
        let p = provider
        return CoachConfig(provider: p, model: model(for: p), apiKey: key(for: p),
                           baseUrl: p == "custom" ? baseUrl : "", timeoutSeconds: timeoutSeconds)
    }
}
