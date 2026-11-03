import Foundation

/// The seams between the decision logic and real macOS. The app supplies real versions
/// (accessibility API, CGEvent keystrokes); tests supply fakes.

/// Ask the focused text box what is selected.
public protocol AccessibilitySource {
    /// Selected text of the focused element, or nil if the app doesn't say.
    func selectedText() -> String?
    /// The whole text of the focused element (used to check a paste), or nil if it can't be read.
    func fieldText() -> String?
}

/// Press keys in whichever app is in front.
public protocol KeyPoster {
    func postCopy()
    func postPaste()
}

/// Is macOS "secure input" on (a password field is focused)? It blocks synthetic keystrokes.
public protocol SecureInputProbe {
    var isSecureInputOn: Bool { get }
}

public enum Waiter {
    /// Poll until `condition` is true or `timeout` seconds pass. Returns whether it became true.
    @discardableResult
    public static func until(timeout: TimeInterval, interval: TimeInterval = 0.01, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(interval))
        }
        return condition()
    }
}
