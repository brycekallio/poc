import Foundation
import LocalAuthentication
import Security

/// Where API keys live. The real one is the macOS Keychain; tests use the in-memory one.
public protocol SecretStore {
    func secret(for account: String) -> String?
    /// An empty value removes the secret.
    func setSecret(_ value: String, for account: String) throws
}

public struct KeychainError: Error, Equatable { public let status: OSStatus }

/// One generic-password item per provider, service `com.brycekallio.poc`. Encrypted and per-user;
/// not iCloud Keychain (no synchronizable flag). Nothing ever lands in UserDefaults or a file.
public struct KeychainStore: SecretStore {
    public let service: String
    public init(service: String = "com.brycekallio.poc") { self.service = service }

    private func query(_ account: String) -> [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account, kSecAttrSynchronizable: false]
    }

    public func secret(for account: String) -> String? {
        var q = query(account)
        q[kSecReturnData] = true
        q[kSecMatchLimit] = kSecMatchLimitOne
        // Never show a password dialog from here: if macOS would ask, treat the key as absent.
        let noPrompt = LAContext()
        noPrompt.interactionNotAllowed = true
        q[kSecUseAuthenticationContext] = noPrompt
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func setSecret(_ value: String, for account: String) throws {
        let delete = SecItemDelete(query(account) as CFDictionary)
        guard delete == errSecSuccess || delete == errSecItemNotFound else { throw KeychainError(status: delete) }
        guard !value.isEmpty else { return }
        var add = query(account)
        add[kSecValueData] = Data(value.utf8)
        add[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlocked
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }
}

public final class InMemorySecretStore: SecretStore {
    private var values: [String: String] = [:]
    public init() {}
    public func secret(for account: String) -> String? { values[account] }
    public func setSecret(_ value: String, for account: String) throws {
        values[account] = value.isEmpty ? nil : value
    }
}
