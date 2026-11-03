import AppKit

public enum SelectionSource: Equatable { case accessibility, copy }

public enum SelectionResult: Equatable {
    case text(String, via: SelectionSource)
    /// Nothing was selected (or nothing could be read). The panel says "Select your draft first".
    case nothingSelected
    /// A password field has focus: macOS blocks keystrokes, so say so instead of failing silently.
    case secureInput
}

/// Reads the user's selection. Accessibility first (invisible), then a simulated ⌘C with the
/// clipboard saved and restored. Never presses ⌘A: in some apps that selects the whole chat.
public struct SelectionReader {
    let ax: AccessibilitySource
    let keys: KeyPoster
    let secure: SecureInputProbe
    let pasteboard: NSPasteboard
    /// How long to wait for the clipboard to change after ⌘C.
    let copyTimeout: TimeInterval

    public init(ax: AccessibilitySource, keys: KeyPoster, secure: SecureInputProbe,
                pasteboard: NSPasteboard = .general, copyTimeout: TimeInterval = 0.3) {
        self.ax = ax; self.keys = keys; self.secure = secure
        self.pasteboard = pasteboard; self.copyTimeout = copyTimeout
    }

    public func read() -> SelectionResult {
        if secure.isSecureInputOn { return .secureInput }
        if let text = ax.selectedText(), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .text(text, via: .accessibility)
        }
        if let text = readByCopying() { return .text(text, via: .copy) }
        return .nothingSelected
    }

    private func readByCopying() -> String? {
        let saved = PasteboardSnapshot(of: pasteboard)
        let before = pasteboard.changeCount
        keys.postCopy()
        let changed = Waiter.until(timeout: copyTimeout) { pasteboard.changeCount != before }
        let copied = changed ? pasteboard.string(forType: .string) : nil
        // Put the user's clipboard back whether or not Copy produced anything.
        if changed { saved.restore(to: pasteboard) }
        guard let copied, !copied.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return copied
    }
}
