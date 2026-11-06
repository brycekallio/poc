import Foundation

/// The global shortcut as plain data, with no UI and no Carbon, so `swift test` covers the rules:
/// what counts as allowed, how it reads on screen (⌃⌥P), and how it is stored.
public struct Shortcut: Equatable {
    /// Which modifier keys are held. Carbon's bit values are applied in the app, not here.
    public struct Modifiers: OptionSet, Equatable {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }
        public static let control = Modifiers(rawValue: 1)
        public static let option = Modifiers(rawValue: 2)
        public static let command = Modifiers(rawValue: 4)
        public static let shift = Modifiers(rawValue: 8)
    }

    public enum Problem: Equatable {
        case needsModifier      // none of ⌃ ⌥ ⌘ held (bare keys and shift-only would steal ordinary typing)
        case reserved           // ⌘⇧P belongs to the Chrome extension
        case unsupportedKey     // a key we can't name on screen (keypad, media keys)
    }

    /// macOS virtual key code (kVK_*), the same numbers Carbon and NSEvent.keyCode use.
    public var keyCode: Int
    public var modifiers: Modifiers

    public init(keyCode: Int, modifiers: Modifiers) { self.keyCode = keyCode; self.modifiers = modifiers }

    /// Default ⌃⌥P (Bryce, 2026-11-02).
    public static let `default` = Shortcut(keyCode: 35, modifiers: [.control, .option])

    public var problem: Problem? {
        if Self.keyNames[keyCode] == nil { return .unsupportedKey }
        if modifiers.isDisjoint(with: [.control, .option, .command]) { return .needsModifier }
        if keyCode == 35, modifiers == [.command, .shift] { return .reserved }
        return nil
    }
    public var isValid: Bool { problem == nil }

    public static func message(for p: Problem) -> String {
        switch p {
        case .needsModifier: return "Hold at least one of ⌃ ⌥ ⌘ with the key, so POC doesn't steal normal typing."
        case .reserved: return "⌘⇧P is the Chrome extension's shortcut. Try another."
        case .unsupportedKey: return "POC can't use that key. Try a letter, number or F-key."
        }
    }

    /// How it reads on screen, in the order macOS writes it: ⌃⌥⇧⌘ then the key.
    public var display: String {
        var s = ""
        if modifiers.contains(.control) { s += "⌃" }
        if modifiers.contains(.option) { s += "⌥" }
        if modifiers.contains(.shift) { s += "⇧" }
        if modifiers.contains(.command) { s += "⌘" }
        return s + (Self.keyNames[keyCode] ?? "?")
    }

    /// The single lowercase character for a menu item's key equivalent, when the key is a letter or digit.
    public var menuCharacter: String? {
        guard let n = Self.keyNames[keyCode], n.count == 1, n.first!.isLetter || n.first!.isNumber else { return nil }
        return n.lowercased()
    }

    static let keyNames: [Int: String] = [
        0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V", 11: "B", 12: "Q", 13: "W", 14: "E",
        15: "R", 16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7", 27: "-",
        28: "8", 29: "0", 30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P", 37: "L", 38: "J", 39: "'", 40: "K", 41: ";",
        42: "\\", 43: ",", 44: "/", 45: "N", 46: "M", 47: ".", 49: "Space", 50: "`",
        122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10",
        103: "F11", 111: "F12", 123: "←", 124: "→", 125: "↓", 126: "↑",
    ]
}

/// Remembers the shortcut in UserDefaults. A missing or invalid stored value falls back to ⌃⌥P.
public struct ShortcutStore {
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var current: Shortcut {
        guard let code = defaults.object(forKey: "shortcut.keyCode") as? Int,
              let mods = defaults.object(forKey: "shortcut.modifiers") as? Int else { return .default }
        let s = Shortcut(keyCode: code, modifiers: .init(rawValue: mods))
        return s.isValid ? s : .default
    }

    /// Saves only a valid shortcut; returns the problem otherwise and changes nothing.
    @discardableResult
    public func set(_ s: Shortcut) -> Shortcut.Problem? {
        if let p = s.problem { return p }
        defaults.set(s.keyCode, forKey: "shortcut.keyCode")
        defaults.set(s.modifiers.rawValue, forKey: "shortcut.modifiers")
        return nil
    }

    public func reset() {
        defaults.removeObject(forKey: "shortcut.keyCode")
        defaults.removeObject(forKey: "shortcut.modifiers")
    }
}
