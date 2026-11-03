import AppKit
import POCCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var hotkey: Hotkey?
    private let panel = PanelController()
    private let ax = MacAccessibility()
    private let keys = MacKeys()
    private let secure = MacSecureInput()
    private var accessItem: NSMenuItem!

    /// What the open card is about.
    private var target: NSRunningApplication?
    private var rewrite = ""
    private var selectionLost = false
    private var busy = false
    /// The card currently on screen, when it is the rewrite card.
    private var readyState: CardState?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Theme.registerFonts()
        buildMenu()
        hotkey = Hotkey { [weak self] in self?.trigger() }
        panel.onUse = { [weak self] in self?.use() }
        panel.onSelectionLost = { [weak self] in self?.markSelectionLost() }
        // Ask Electron apps to expose their text boxes as soon as they come to the front.
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
            if let a = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication, a.bundleIdentifier != Bundle.main.bundleIdentifier {
                MacAccessibility.wakeUp(pid: a.processIdentifier)
            }
        }
        if let front = NSWorkspace.shared.frontmostApplication { MacAccessibility.wakeUp(pid: front.processIdentifier) }
        if !Permissions.accessibilityGranted { Permissions.promptAccessibility() }
    }

    // MARK: Menu bar

    private func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = Self.menuBarMark()
        statusItem.button?.setAccessibilityLabel("P.O.C, Prompt Optimization Coach")
        let menu = NSMenu()
        menu.autoenablesItems = false
        let coach = NSMenuItem(title: "Coach the selected text", action: #selector(trigger), keyEquivalent: "p")
        coach.keyEquivalentModifierMask = [.control, .option]
        coach.target = self
        menu.addItem(coach)
        menu.addItem(.separator())
        accessItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        accessItem.isEnabled = false
        menu.addItem(accessItem)
        let open = NSMenuItem(title: "Open Accessibility settings…", action: #selector(openAccess), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit POC", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        menu.delegate = self
        statusItem.menu = menu
        refreshAccessItem()
    }

    fileprivate func refreshAccessItem() {
        accessItem.title = Permissions.accessibilityGranted ? "Accessibility: allowed ✓" : "Accessibility: needed — POC can't read or paste yet"
    }

    @objc private func openAccess() { Permissions.openAccessibilitySettings() }

    /// A small template image (the system tints it for light/dark): p, a disc, c.
    private static func menuBarMark() -> NSImage {
        let image = NSImage(size: NSSize(width: 26, height: 16), flipped: false) { rect in
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.black]
            NSAttributedString(string: "p", attributes: attrs).draw(at: NSPoint(x: 1, y: 1))
            NSAttributedString(string: "c", attributes: attrs).draw(at: NSPoint(x: 17, y: 1))
            NSColor.black.setFill()
            NSBezierPath(ovalIn: NSRect(x: 10.5, y: 4.5, width: 5, height: 5)).fill()
            return true
        }
        image.isTemplate = true
        return image
    }

    // MARK: The flow: shortcut → read selection → card → Use → paste back

    @objc func trigger() {
        guard !busy else { return }
        Debug.log("hotkey fired; accessibility trusted=\(Permissions.accessibilityGranted)")
        let front = NSWorkspace.shared.frontmostApplication
        // The menu item is clicked while POC is "frontmost" for a moment; the real target is whatever was before.
        if front?.bundleIdentifier != Bundle.main.bundleIdentifier { target = front }
        guard let target else { return }
        ax.targetPID = target.processIdentifier
        MacAccessibility.wakeUp(pid: target.processIdentifier)

        guard Permissions.accessibilityGranted else {
            Permissions.promptAccessibility()
            panel.show(.message(title: "POC needs Accessibility",
                                detail: "1. Click the button below.\n2. Switch POC on in the list (the switch turns blue).\n3. Select your text and press ⌃⌥P again.",
                                action: .openAccessibility), near: nil, takeKeys: true)
            return
        }

        let reader = SelectionReader(ax: ax, keys: keys, secure: secure)
        let rect = ax.selectionRect()
        selectionLost = false
        readyState = nil
        let result = reader.read()
        Debug.log("selection: \(result) rect=\(String(describing: rect)) front=\(target.localizedName ?? "?")")
        switch result {
        case let .text(draft, via):
            rewrite = FakeRewrite.rewrite(draft)
            let state = CardState.ready(draft: draft, rewrite: rewrite, app: target.localizedName ?? "this app",
                                        via: via == .accessibility ? "read directly" : "read via copy", selectionLost: false)
            readyState = state
            panel.show(state, near: rect ?? ax.selectionRect(), takeKeys: true)
        case .nothingSelected:
            panel.show(.message(title: "Select your draft first",
                                detail: "Highlight the text in \(target.localizedName ?? "the app"), then press ⌃⌥P.", action: nil),
                       near: rect, takeKeys: true)
        case .secureInput:
            panel.show(.message(title: "A password field is focused",
                                detail: "macOS blocks other apps from reading or typing there. Click into your draft and try again.", action: nil),
                       near: rect, takeKeys: true)
        }
    }

    private func markSelectionLost() {
        guard !selectionLost, case let .ready(d, r, a, v, _)? = readyState else { return }
        selectionLost = true
        let lost = CardState.ready(draft: d, rewrite: r, app: a, via: v, selectionLost: true)
        readyState = lost
        panel.update(lost)
    }

    private func use() {
        guard !busy, let target else { return }
        busy = true
        defer { busy = false }
        let text = rewrite

        if selectionLost {
            let pb = NSPasteboard.general
            pb.clearContents(); pb.setString(text, forType: .string)
            panel.show(.result(text: "Copied — press ⌘V where you want it", ok: false), near: nil, takeKeys: false, autoHideAfter: 4)
            return
        }

        // Hand the keyboard back to the app the draft came from before pasting into it.
        let anchor = ax.selectionRect()
        panel.hide()
        target.activate()
        RunLoop.current.run(until: Date().addingTimeInterval(0.12))
        let outcome = WriteBack(ax: ax, keys: keys, secure: secure).write(text)
        Debug.log("write-back: \(outcome)")
        switch outcome {
        case .pasted:
            panel.show(.result(text: "Pasted ✓", ok: true), near: anchor, takeKeys: false, autoHideAfter: 1.6)
        case .unverified:
            panel.show(.result(text: "Pasted, but this app won't confirm it. If nothing changed, press ⌘V.", ok: false), near: anchor, takeKeys: false, autoHideAfter: 5)
        case .copiedOnly:
            panel.show(.result(text: "Copied — press ⌘V to paste", ok: false), near: anchor, takeKeys: false, autoHideAfter: 4)
        case .blockedBySecureInput:
            panel.show(.result(text: "Copied — a password field blocks pasting", ok: false), near: anchor, takeKeys: false, autoHideAfter: 4)
        }
    }
}

extension AppDelegate: NSMenuDelegate {
    func menuWillOpen(_ menu: NSMenu) { refreshAccessItem() }
}
