import AppKit
import POCCore
import POCEngine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var hotkey: Hotkey?
    private let panel = PanelController()
    private let ax = MacAccessibility()
    private let keys = MacKeys()
    private let secure = MacSecureInput()
    private var accessItem: NSMenuItem!
    private var modelItem: NSMenuItem!

    private let settings = CoachSettings()
    private let shortcutStore = ShortcutStore()
    private var coachItem: NSMenuItem!
    private lazy var home: HomeWindowController = {
        let m = HomeModel(settings: settings)
        m.runTest = { [weak self] config in
            guard let self else { return .failure(CoachFailure(code: "gone", message: "POC is closing.")) }
            // One cheap real call: the first coaching call on a tiny draft. Proves address, key and model together.
            switch await self.engine.diagnose(config: config, draft: "write an email to my team", host: "") {
            case let .success(d): return .success(d.questions.count)
            case let .failure(f): return .failure(f)
            }
        }
        m.onSaved = { [weak self] in self?.refreshModelItem() }
        m.shortcutState = hotkey?.state ?? .working
        m.onRecording = { [weak self, weak m] on in
            on ? self?.hotkey?.suspend() : self?.hotkey?.resume()
            if !on, let state = self?.hotkey?.state { m?.shortcutState = state; self?.refreshCoachItem(self?.shortcutStore.current ?? .default) }
        }
        m.onShortcutChange = { [weak self, weak m] s in
            guard let self, self.hotkey?.update(s) ?? true else {
                if m?.recording == true { self?.hotkey?.suspend() }   // update() put the old one back; keep it off while the recorder is open
                return false
            }
            self.refreshCoachItem(s)
            return true
        }
        return HomeWindowController(model: m)
    }()
    /// The coach: the extension's JS in a hidden web view. Started at launch so the first press is not slow.
    private lazy var engine = WebCoachEngine(directory: Self.webDirectory)

    /// What the open card is about.
    private var target: NSRunningApplication?
    private var session: CoachSession?
    private var coachApp = ""
    private var coachDraft = ""
    private var selectionLost = false
    private var busy = false

    /// The bundled engine: the app's Resources/web, or a checkout's desktop/Resources/web when run with `swift run`.
    private static var webDirectory: URL {
        if let dir = ProcessInfo.processInfo.environment["POC_WEB_DIR"] { return URL(fileURLWithPath: dir) }
        return (Bundle.main.resourceURL ?? URL(fileURLWithPath: ".")).appendingPathComponent("web")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Theme.registerFonts()
        buildMenu()
        hotkey = Hotkey(shortcutStore.current) { [weak self] in self?.trigger() }
        refreshCoachItem(shortcutStore.current)
        panel.onUse = { [weak self] in self?.use() }
        panel.onReturn = { [weak self] in self?.pressReturn() }
        panel.onDigit = { [weak self] n in self?.pickOption(n) }
        panel.onDismiss = { [weak self] in self?.endSession() }
        let m = panel.coachModel
        m.onChoose = { [weak self] a in self?.session?.choose(a) }
        m.onBack = { [weak self] in self?.session?.back() }
        m.onChangeAnswers = { [weak self] in self?.session?.changeAnswers() }
        m.onRewrite = { [weak self] in self?.session?.rewrite() }
        m.onRetry = { [weak self] in self?.session?.retry() }
        m.onLeaveResult = { [weak self] in self?.session?.leaveResult() }
        m.onOpenSettings = { [weak self] in self?.openSettings() }
        panel.onSelectionLost = { [weak self] in self?.markSelectionLost() }
        // Ask Electron apps to expose their text boxes as soon as they come to the front.
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
            if let a = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication, a.bundleIdentifier != Bundle.main.bundleIdentifier {
                MacAccessibility.wakeUp(pid: a.processIdentifier)
            }
        }
        if let front = NSWorkspace.shared.frontmostApplication { MacAccessibility.wakeUp(pid: front.processIdentifier) }
        _ = engine
        if ProcessInfo.processInfo.environment["POC_SELFTEST"] == "cards" {
            renderCards(); NSApp.terminate(nil)   // offscreen PNGs of every card step, nothing shown
        } else if ProcessInfo.processInfo.environment["POC_SELFTEST"] == "coach" {
            Task { await selfTest() }   // no Accessibility dialog, no hotkey use: just the coach
        } else if ProcessInfo.processInfo.environment["POC_SELFTEST"] == "home" {
            renderHome(); NSApp.terminate(nil)
        } else {
            // Opening the app must visibly do something: show the window (menu-bar-only apps have no Dock icon,
            // and on a notched Mac the menu-bar icon can be hidden). The Accessibility prompt follows on its own.
            showHome()
            if !Permissions.accessibilityGranted { Permissions.promptAccessibility() }
        }
    }

    /// Double-clicking POC while it is already running lands here (and `open` a second time).
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        Debug.log("reopen requested; visible=\(flag)")
        showHome()
        return true
    }

    private func showHome(reloadSettings: Bool = false) {
        guard HomeStatus.shouldShowWindow(selfTest: ProcessInfo.processInfo.environment["POC_SELFTEST"]) else { return }
        home.show(reloadSettings: reloadSettings)
        Debug.log("home window shown; visible windows=\(NSApp.windows.filter { $0.isVisible && $0.title.hasPrefix("POC") }.map(\.title))")
        // Evidence hook: close it shortly after showing, so a second `open` can prove it comes back.
        if ProcessInfo.processInfo.environment["POC_DEBUG_AUTOCLOSE"] != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.home.hide(); Debug.log("debug: window closed") }
        }
    }

    // MARK: Menu bar

    private func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = Self.menuBarMark()
        statusItem.button?.setAccessibilityLabel("P.O.C, Prompt Optimization Coach")
        let menu = NSMenu()
        menu.autoenablesItems = false
        let coach = NSMenuItem(title: "Coach the selected text", action: #selector(trigger), keyEquivalent: "p")
        coach.target = self
        coachItem = coach
        refreshCoachItem(shortcutStore.current)
        menu.addItem(coach)
        modelItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        modelItem.isEnabled = false
        menu.addItem(modelItem)
        let about = NSMenuItem(title: "Open POC window", action: #selector(openHome), keyEquivalent: "")
        about.target = self
        menu.addItem(about)
        let prefs = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        prefs.target = self
        menu.addItem(prefs)
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
        refreshModelItem()
    }

    /// The menu shows the current shortcut next to "Coach the selected text" (letters and digits only; other keys show none).
    fileprivate func refreshCoachItem(_ s: Shortcut) {
        // A shortcut macOS refused doesn't work, so the menu must not show it as if it did.
        guard hotkey?.state ?? .working == .working else { coachItem.keyEquivalent = ""; coachItem.keyEquivalentModifierMask = []; return }
        coachItem.keyEquivalent = s.menuCharacter ?? ""
        var mask: NSEvent.ModifierFlags = []
        if s.modifiers.contains(.control) { mask.insert(.control) }
        if s.modifiers.contains(.option) { mask.insert(.option) }
        if s.modifiers.contains(.command) { mask.insert(.command) }
        if s.modifiers.contains(.shift) { mask.insert(.shift) }
        coachItem.keyEquivalentModifierMask = mask
    }

    fileprivate func refreshModelItem() {
        let p = CoachSettings.providers.first { $0.id == settings.provider }
        let model = settings.model(for: settings.provider)
        modelItem.title = "Model: \(p?.name.components(separatedBy: " (").first ?? settings.provider) · \(model.isEmpty ? "automatic" : model)"
    }

    @objc private func openHome() { showHome() }

    @objc private func openSettings() {
        // The dialog takes the keyboard, so the selection in the other app is gone: Use will copy.
        if panel.isVisible { markSelectionLost() }
        showHome(reloadSettings: true)
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
                                detail: "1. Click the button below.\n2. Switch POC on in the list (the switch turns blue).\n3. Select your text and press \(shortcutStore.current.display) again.",
                                action: .openAccessibility), near: nil, takeKeys: true)
            return
        }

        let reader = SelectionReader(ax: ax, keys: keys, secure: secure)
        let rect = ax.selectionRect()
        selectionLost = false
        let result = reader.read()
        Debug.log("selection: \(result) rect=\(String(describing: rect)) front=\(target.localizedName ?? "?")")
        switch result {
        case let .text(draft, _):
            coachApp = target.localizedName ?? "this app"
            coachDraft = draft
            startSession(draft: draft, anchor: rect ?? ax.selectionRect())
        case .nothingSelected:
            panel.show(.message(title: "Select your draft first",
                                detail: "Highlight the text in \(target.localizedName ?? "the app"), then press \(shortcutStore.current.display).", action: nil),
                       near: rect, takeKeys: true)
        case .secureInput:
            panel.show(.message(title: "A password field is focused",
                                detail: "macOS blocks other apps from reading or typing there. Click into your draft and try again.", action: nil),
                       near: rect, takeKeys: true)
        }
    }

    private func startSession(draft: String, anchor: CGRect?) {
        endSession()
        let s = CoachSession(engine: engine, config: { [settings] in settings.current() }, draft: draft, host: HostLabel.label(forApp: coachApp))
        session = s
        s.onChange = { [weak self] in self?.render() }
        panel.show(.coach(CoachCardState(step: s.step, draft: draft, app: coachApp, selectionLost: false)), near: anchor, takeKeys: true)
        s.start()
    }

    private func render() {
        guard let s = session else { return }
        panel.update(.coach(CoachCardState(step: s.step, draft: coachDraft, app: coachApp, selectionLost: selectionLost)))
    }

    /// The card is closed or done: stop any model call and forget the session.
    private func endSession() {
        session?.cancel()
        session = nil
    }

    /// Return does the obvious next thing for the step on screen.
    private func pressReturn() {
        guard let s = session else { return }
        switch s.step {
        case .summary: s.rewrite()
        case .result: use()
        case let .error(f): f.needsSettings ? openSettings() : s.retry()
        default: break
        }
    }

    private func pickOption(_ n: Int) {
        guard let s = session, case let .question(q, _, _, _) = s.step, n >= 1, n <= q.options.count else { return }
        s.choose(q.options[n - 1])
    }

    private func markSelectionLost() {
        guard !selectionLost else { return }
        selectionLost = true
        render()
    }

    private func use() {
        guard !busy, let target, let text = session?.textToPaste else { return }
        busy = true
        defer { busy = false }
        endSession()

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
    func menuWillOpen(_ menu: NSMenu) { refreshAccessItem(); refreshModelItem() }
}

// MARK: Self-test (no other app involved)

extension AppDelegate {
    /// `POC_SELFTEST=coach open --env POC_SELFTEST=coach --env POC_DEBUG_DIR=/tmp/x dist/POC.app` runs one real
    /// coaching round through this app's own bundle (resources, Info.plist network rules, signature) against the
    /// configured model, logs it to POC_DEBUG_DIR/poc.log and quits. It never reads a selection or pastes.
    fileprivate func selfTest() async {
        let draft = ProcessInfo.processInfo.environment["POC_SELFTEST_DRAFT"] ?? "write a summary of the q3 report for the team, make it good and not too long"
        let config = settings.current()
        Debug.log("selftest: \(config) web=\(Self.webDirectory.path)")
        let t0 = Date()
        switch await engine.diagnose(config: config, draft: draft, host: HostLabel.label(forApp: "Claude")) {
        case let .failure(f): Debug.log("selftest: call 1 FAILED [\(f.code)] \(f.message)")
        case let .success(d):
            Debug.log("selftest: call 1 ok in \(String(format: "%.1f", Date().timeIntervalSince(t0))) s, \(d.questions.count) question(s): \(d.questions.map(\.question))")
            let t1 = Date()
            let answers = d.questions.map { Answer(question: $0.question, answer: $0.options.first) }
            switch await engine.rewrite(config: config, draft: draft, answers: answers, reader: d.reader, host: HostLabel.label(forApp: "Claude"), onPartial: { _ in }) {
            case let .failure(f): Debug.log("selftest: call 2 FAILED [\(f.code)] \(f.message)")
            case let .success(r): Debug.log("selftest: call 2 ok in \(String(format: "%.1f", Date().timeIntervalSince(t1))) s: \(r.prompt)")
            }
        }
        NSApp.terminate(nil)
    }
}

extension AppDelegate {
    /// POC_SELFTEST=home: PNGs of the home window with a throwaway settings store, never on screen.
    fileprivate func renderHome() {
        let scratch = CoachSettings(defaults: UserDefaults(suiteName: "poc.render.\(UUID().uuidString)")!, secrets: InMemorySecretStore())
        let scratchShortcut = ShortcutStore(defaults: UserDefaults(suiteName: "poc.render.sc.\(UUID().uuidString)")!)
        scratch.provider = "anthropic"
        let m = HomeModel(settings: scratch, shortcutStore: scratchShortcut)
        m.accessibility = false
        HomeWindowController(model: m).render(to: "home-needs-key", hasKeyState: false)
        scratch.provider = "ollama"
        let m2 = HomeModel(settings: scratch, shortcutStore: scratchShortcut)
        m2.accessibility = true
        m2.status = "Connected. The model answered."
        HomeWindowController(model: m2).render(to: "home-ok", hasKeyState: true)
    }

    /// Renders each coaching step to POC_DEBUG_DIR as PNG, straight from the SwiftUI view (never on screen).
    fileprivate func renderCards() {
        let q = CoachQuestion(id: "a", quote: "make it good", question: "Is the summary for your manager or the engineers who wrote the code?",
                              options: ["My manager", "The engineers", "Leadership, in plain words"])
        let r = RewriteResult(prompt: "Write a one-page summary of the Q3 report for the engineers who wrote the code. Lead with what changed since Q2, then the three biggest risks, in plain words.",
                              techniques: ["Clear deliverable", "Purpose & audience", "Format & length"], unverified: [])
        let steps: [(String, CoachSession.Step)] = [
            ("1-asking", .asking), ("2-question", .question(q, index: 0, total: 2, chosen: nil)),
            ("3-summary", .summary([.init(question: q.question, answer: "The engineers"), .init(question: "How long?", answer: nil)])),
            ("4-rewriting", .rewriting(partial: "Write a one-page summary of the Q3 report for the")), ("5-result", .result(r)),
            ("6-error-nokey", .error(CoachFailure(code: "no-key", message: "No API key yet."))),
            ("7-error-timeout", .error(CoachFailure(code: "timeout", message: "The model took longer than 90 seconds. Try again, or pick a faster model."))),
        ]
        for scheme in [NSAppearance.Name.darkAqua, .aqua] {
            for (name, step) in steps {
                let model = CardModel(state: .coach(CoachCardState(step: step, draft: "write a summary of the q3 report", app: "Claude", selectionLost: false)))
                let host = NSHostingView(rootView: CardView(model: model))
                host.appearance = NSAppearance(named: scheme)
                host.frame = NSRect(origin: .zero, size: host.fittingSize)
                host.layoutSubtreeIfNeeded()
                Debug.snapshot(host, name: "\(scheme == .darkAqua ? "dark" : "light")-\(name)")
            }
        }
    }
}
