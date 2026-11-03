import AppKit

public enum WriteBackOutcome: Equatable {
    /// ⌘V was sent and the text box now contains the rewrite. The user's clipboard was restored.
    case pasted
    /// ⌘V was sent but the app doesn't expose its text, so we can't confirm. The rewrite stays on the
    /// clipboard so "⌘V" still works if the paste didn't land.
    case unverified
    /// The text box was readable and does not contain the rewrite. Rewrite is on the clipboard.
    case copiedOnly
    /// A password field is focused (secure input); nothing was sent. Rewrite is on the clipboard.
    case blockedBySecureInput
}

/// Puts the rewrite into the app the draft came from: paste, then check, then fall back to the clipboard.
/// Paste (not setting the field's value) because rich editors only notice text that arrives through
/// their own paste handler. That is the bug the Chrome extension fought with innerHTML.
public struct WriteBack {
    let ax: AccessibilitySource
    let keys: KeyPoster
    let secure: SecureInputProbe
    let pasteboard: NSPasteboard
    let settle: TimeInterval
    let restoreDelay: TimeInterval

    public init(ax: AccessibilitySource, keys: KeyPoster, secure: SecureInputProbe,
                pasteboard: NSPasteboard = .general, settle: TimeInterval = 0.6, restoreDelay: TimeInterval = 0.3) {
        self.ax = ax; self.keys = keys; self.secure = secure
        self.pasteboard = pasteboard; self.settle = settle; self.restoreDelay = restoreDelay
    }

    public func write(_ rewrite: String) -> WriteBackOutcome {
        let saved = PasteboardSnapshot(of: pasteboard)
        pasteboard.clearContents()
        pasteboard.setString(rewrite, forType: .string)

        if secure.isSecureInputOn { return .blockedBySecureInput }

        let fieldBefore = ax.fieldText()
        keys.postPaste()

        // Wait for the editor to catch up (async editors update a beat after the keystroke).
        let landed = Waiter.until(timeout: settle) { Self.contains(ax.fieldText(), rewrite) }
        if landed {
            // Apps read the clipboard lazily; wait a moment before swapping the user's content back.
            RunLoop.current.run(until: Date().addingTimeInterval(restoreDelay))
            saved.restore(to: pasteboard)
            return .pasted
        }
        // Couldn't see the rewrite. Distinguish "can't read this app" from "read it, and it's not there".
        if fieldBefore == nil && ax.fieldText() == nil { return .unverified }
        return .copiedOnly
    }

    /// True if `field` contains the start of the rewrite (editors may reflow lists and whitespace,
    /// so compare a normalised prefix rather than the whole text).
    static func contains(_ field: String?, _ rewrite: String) -> Bool {
        guard let field else { return false }
        let head = String(normalise(rewrite).prefix(40))
        return !head.isEmpty && normalise(field).contains(head)
    }

    static func normalise(_ s: String) -> String {
        s.lowercased().split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }
}
