import AppKit
import SwiftUI
import POCCore

/// A floating card that takes keystrokes without activating POC, the way Spotlight does, so the app
/// the draft came from stays frontmost and its selection stays highlighted.
final class CardPanel: NSPanel {
    var onEscape: () -> Void = {}
    var onReturn: () -> Void = {}
    /// 1–9: pick that numbered option.
    var onDigit: (Int) -> Void = { _ in }
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53: onEscape()          // esc
        case 36, 76: onReturn()      // return, keypad enter
        default:
            if let c = event.charactersIgnoringModifiers, c.count == 1, let n = Int(c), n >= 1,
               event.modifierFlags.intersection([.command, .control, .option]).isEmpty { onDigit(n) }
            else { super.keyDown(with: event) }
        }
    }
    override func cancelOperation(_ sender: Any?) { onEscape() }
}

final class PanelController {
    private let panel: CardPanel
    private let model = CardModel(state: .message(title: "", detail: "", action: nil))
    private let host: NSHostingView<CardView>
    private var mouseMonitor: Any?
    private var hideTimer: Timer?
    /// Called when the user presses Use/Copy (or return on the rewrite).
    var onUse: () -> Void = {}
    /// Return/digits/buttons of the coaching steps; the app delegate owns the session.
    var onReturn: () -> Void = {}
    var onDigit: (Int) -> Void = { _ in }
    /// The user closed the card (esc or the X): stop any model call. Not called by programmatic hides.
    var onDismiss: () -> Void = {}
    var coachModel: CardModel { model }
    /// Called when the user clicked outside the panel while it was open (the selection is gone).
    var onSelectionLost: () -> Void = {}

    init() {
        host = NSHostingView(rootView: CardView(model: model))
        panel = CardPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 200),
                          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.contentView = host
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hasShadow = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        model.onClose = { [weak self] in self?.dismiss() }
        model.onUse = { [weak self] in self?.onUse() }
        model.onAction = { action in
            switch action { case .openAccessibility: Permissions.openAccessibilitySettings() }
        }
        panel.onEscape = { [weak self] in self?.dismiss() }
        panel.onReturn = { [weak self] in self?.onReturn() }
        panel.onDigit = { [weak self] n in self?.onDigit(n) }
    }

    var isVisible: Bool { panel.isVisible }

    /// `anchor` is the selection rectangle in screen coordinates (top-left origin), or nil.
    func show(_ state: CardState, near anchor: CGRect?, takeKeys: Bool, autoHideAfter: TimeInterval? = nil) {
        hideTimer?.invalidate()
        model.state = state
        host.layoutSubtreeIfNeeded()
        let size = host.fittingSize
        panel.setContentSize(size)
        panel.setFrameOrigin(Self.cocoaOrigin(for: size, anchor: anchor))
        if takeKeys { panel.makeKeyAndOrderFront(nil) } else { panel.orderFrontRegardless() }
        watchForClickAway()
        Debug.snapshot(host, name: "card-\(Int(Date().timeIntervalSince1970 * 1000))")
        if let t = autoHideAfter {
            hideTimer = Timer.scheduledTimer(withTimeInterval: t, repeats: false) { [weak self] _ in self?.hide() }
        }
    }

    func update(_ state: CardState) {
        model.state = state
        host.layoutSubtreeIfNeeded()
        let top = panel.frame.maxY
        let size = host.fittingSize
        panel.setContentSize(size)
        panel.setFrameTopLeftPoint(NSPoint(x: panel.frame.minX, y: top))
        keepOnScreen()
        Debug.snapshot(host, name: "card-\(Int(Date().timeIntervalSince1970 * 1000))")
    }

    /// The card grows as the steps change; nudge it back if it now hangs off the bottom of the screen.
    private func keepOnScreen() {
        guard let visible = (panel.screen ?? NSScreen.main)?.visibleFrame else { return }
        var f = panel.frame
        if f.minY < visible.minY + 8 { f.origin.y = visible.minY + 8 }
        if f.maxY > visible.maxY { f.origin.y = visible.maxY - f.height }
        if f != panel.frame { panel.setFrame(f, display: true) }
    }

    /// The user closed the card.
    func dismiss() {
        hide()
        onDismiss()
    }

    func hide() {
        hideTimer?.invalidate()
        if let m = mouseMonitor { NSEvent.removeMonitor(m); mouseMonitor = nil }
        panel.orderOut(nil)
    }

    private func watchForClickAway() {
        if mouseMonitor != nil { return }
        // Global monitors for mouse clicks in other apps need no permission.
        mouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, self.panel.isVisible else { return }
            self.onSelectionLost()
        }
    }

    /// Converts the top-left-origin screen rectangle to the bottom-left origin AppKit wants,
    /// placing the card with `PanelPlacement` on whichever screen holds the anchor.
    static func cocoaOrigin(for size: CGSize, anchor: CGRect?) -> NSPoint {
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        func topLeft(_ r: NSRect) -> CGRect { CGRect(x: r.minX, y: primaryHeight - r.maxY, width: r.width, height: r.height) }
        let screen = NSScreen.screens.first { s in
            guard let a = anchor else { return false }
            return topLeft(s.frame).contains(CGPoint(x: a.midX, y: a.midY))
        } ?? NSScreen.main ?? NSScreen.screens[0]
        let origin = PanelPlacement.origin(panel: size, selection: anchor, screen: topLeft(screen.visibleFrame))
        return NSPoint(x: origin.x, y: primaryHeight - origin.y - size.height)
    }
}
