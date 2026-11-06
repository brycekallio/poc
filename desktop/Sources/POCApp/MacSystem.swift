import AppKit
import ApplicationServices
import Carbon.HIToolbox
import POCCore

/// Real macOS implementations of the seams in POCCore. Everything here needs a live desktop,
/// so it is exercised by running the app (see BUILD.md), not by `swift test`.

/// Reads the focused text box of the frontmost app through the accessibility API.
final class MacAccessibility: AccessibilitySource {
    var targetPID: pid_t?

    private var app: AXUIElement? {
        guard let pid = targetPID ?? NSWorkspace.shared.frontmostApplication?.processIdentifier else { return nil }
        return AXUIElementCreateApplication(pid)
    }

    /// Electron apps (Claude Desktop, T3 Code) only build their accessibility tree when they think a
    /// screen reader is running. This flag is the documented way to ask them to.
    static func wakeUp(pid: pid_t) {
        let el = AXUIElementCreateApplication(pid)
        AXUIElementSetAttributeValue(el, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    }

    func focusedElement() -> AXUIElement? {
        guard let app else { return nil }
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &ref) == .success,
              let ref, CFGetTypeID(ref) == AXUIElementGetTypeID() else { return nil }
        return (ref as! AXUIElement)
    }

    private func string(_ attr: String) -> String? {
        guard let el = focusedElement() else { return nil }
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success else { return nil }
        return ref as? String
    }

    func selectedText() -> String? { string(kAXSelectedTextAttribute) }
    func fieldText() -> String? { string(kAXValueAttribute) }

    /// Screen rectangle (top-left origin, y down) of the selection, else of the whole text box, else nil.
    func selectionRect() -> CGRect? {
        guard let el = focusedElement() else { return nil }
        var rangeRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(el, kAXSelectedTextRangeAttribute as CFString, &rangeRef) == .success,
           let rangeRef, CFGetTypeID(rangeRef) == AXValueGetTypeID() {
            var boundsRef: CFTypeRef?
            if AXUIElementCopyParameterizedAttributeValue(el, kAXBoundsForRangeParameterizedAttribute as CFString, rangeRef, &boundsRef) == .success,
               let boundsRef, CFGetTypeID(boundsRef) == AXValueGetTypeID() {
                var rect = CGRect.zero
                if AXValueGetValue(boundsRef as! AXValue, .cgRect, &rect), rect.width > 0 || rect.height > 0 { return rect }
            }
        }
        return frame(of: el)
    }

    private func frame(of el: AXUIElement) -> CGRect? {
        var posRef: CFTypeRef?, sizeRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posRef) == .success,
              AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeRef) == .success,
              let posRef, let sizeRef else { return nil }
        var p = CGPoint.zero, s = CGSize.zero
        guard AXValueGetValue(posRef as! AXValue, .cgPoint, &p), AXValueGetValue(sizeRef as! AXValue, .cgSize, &s) else { return nil }
        return CGRect(origin: p, size: s)
    }
}

/// Posts ⌘C / ⌘V to the frontmost app.
struct MacKeys: KeyPoster {
    func postCopy() { post(key: CGKeyCode(kVK_ANSI_C)) }
    func postPaste() { post(key: CGKeyCode(kVK_ANSI_V)) }

    private func post(key: CGKeyCode) {
        let source = CGEventSource(stateID: .combinedSessionState)
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down)
            event?.flags = .maskCommand
            event?.post(tap: .cghidEventTap)
        }
    }
}

struct MacSecureInput: SecureInputProbe {
    var isSecureInputOn: Bool { IsSecureEventInputEnabled() }
}

/// The global shortcut. Carbon's RegisterEventHotKey needs no permission and swallows the keypress,
/// so the app underneath never also reacts to it. (NSEvent global monitors can't do either.)
/// Hand-rolled instead of the KeyboardShortcuts package: no dependency, so the build stays offline-safe.
final class Hotkey {
    private var ref: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let action: () -> Void
    private(set) var shortcut: Shortcut

    init(_ shortcut: Shortcut, action: @escaping () -> Void) {
        self.action = action
        self.shortcut = shortcut
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
            guard let userData else { return noErr }
            Unmanaged<Hotkey>.fromOpaque(userData).takeUnretainedValue().action()
            return noErr
        }, 1, &spec, selfPtr, &handler)
        _ = register(shortcut)
    }

    private func register(_ s: Shortcut) -> Bool {
        unregister()
        let id = EventHotKeyID(signature: OSType(0x504F4320) /* 'POC ' */, id: 1)
        return RegisterEventHotKey(UInt32(s.keyCode), Self.carbonModifiers(s.modifiers), id, GetApplicationEventTarget(), 0, &ref) == noErr
    }

    private func unregister() {
        if let ref { UnregisterEventHotKey(ref) }
        ref = nil
    }

    /// Switch to a new shortcut live. If macOS refuses it (another app owns it), the old one is restored and this returns false.
    @discardableResult
    func update(_ s: Shortcut) -> Bool {
        if register(s) { shortcut = s; return true }
        _ = register(shortcut)
        return false
    }

    /// Stop listening while the recorder is open, so pressing the current shortcut records it instead of firing it.
    func suspend() { unregister() }
    func resume() { _ = register(shortcut) }

    static func carbonModifiers(_ m: Shortcut.Modifiers) -> UInt32 {
        var c = 0
        if m.contains(.control) { c |= controlKey }
        if m.contains(.option) { c |= optionKey }
        if m.contains(.command) { c |= cmdKey }
        if m.contains(.shift) { c |= shiftKey }
        return UInt32(c)
    }

    static func modifiers(from flags: NSEvent.ModifierFlags) -> Shortcut.Modifiers {
        var m: Shortcut.Modifiers = []
        if flags.contains(.control) { m.insert(.control) }
        if flags.contains(.option) { m.insert(.option) }
        if flags.contains(.command) { m.insert(.command) }
        if flags.contains(.shift) { m.insert(.shift) }
        return m
    }

    deinit {
        unregister()
        if let handler { RemoveEventHandler(handler) }
    }
}

enum Permissions {
    static var accessibilityGranted: Bool { AXIsProcessTrusted() }
    static func promptAccessibility() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }
    static func openAccessibilitySettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }
}
