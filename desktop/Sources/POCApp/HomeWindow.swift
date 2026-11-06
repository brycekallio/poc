import AppKit
import POCCore
import SwiftUI

/// The state behind the home window: is POC allowed to work, and the Settings form.
@MainActor
final class HomeModel: ObservableObject {
    @Published var accessibility = Permissions.accessibilityGranted
    @Published var form: SettingsForm
    @Published var status: String = ""
    @Published var statusIsError = false
    @Published var testing = false
    @Published var showProblems = false
    @Published var shortcut: Shortcut
    @Published var recording = false
    @Published var shortcutNote = ""
    @Published var shortcutNoteIsError = false
    @Published var shortcutState: ShortcutState = .working

    let settings: CoachSettings
    /// One cheap real call with the form's config (no Keychain write). Provided by the app delegate.
    var runTest: (CoachConfig) async -> Result<Int, CoachFailure> = { _ in .failure(CoachFailure(code: "none", message: "No engine.")) }
    var onSaved: () -> Void = {}
    var onQuit: () -> Void = { NSApp.terminate(nil) }
    /// Applies a new shortcut live; false if macOS refused it. Provided by the app delegate.
    var onShortcutChange: (Shortcut) -> Bool = { _ in true }
    var onRecording: (Bool) -> Void = { _ in }
    let shortcutStore: ShortcutStore
    private var monitor: Any?

    init(settings: CoachSettings, shortcutStore: ShortcutStore = ShortcutStore()) {
        self.settings = settings
        self.shortcutStore = shortcutStore
        shortcut = shortcutStore.current
        form = SettingsForm.load(from: settings)
    }

    func refreshAccessibility() { accessibility = Permissions.accessibilityGranted }
    func reloadForm() { form = SettingsForm.load(from: settings); status = ""; showProblems = false }

    func pick(provider: String) {
        form = SettingsForm.load(from: settings, provider: provider)
        status = ""; showProblems = false
    }

    func save() {
        guard form.isValid else { showProblems = true; return }
        do {
            try form.save(to: settings)
            form = SettingsForm.load(from: settings)   // clears the typed key; the field now says "Saved in Keychain"
            status = "Saved."; statusIsError = false
            onSaved()
        } catch {
            // Never echo the key; the Keychain status code is enough.
            status = "Couldn't save the key to your Keychain (\(error)). It was not stored anywhere else."; statusIsError = true
        }
    }

    // MARK: Shortcut recorder

    func startRecording() {
        guard !recording else { return }
        recording = true; shortcutNote = "Press the new shortcut. Esc cancels."; shortcutNoteIsError = false
        onRecording(true)
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            MainActor.assumeIsolated {
                guard let self else { return event }
                if event.keyCode == 53 { self.stopRecording(); self.shortcutNote = ""; return nil }   // Esc
                self.capture(Shortcut(keyCode: Int(event.keyCode), modifiers: Hotkey.modifiers(from: event.modifierFlags)))
                return nil
            }
        }
    }

    func stopRecording() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        guard recording else { return }
        recording = false
        onRecording(false)
    }

    /// Validate, apply live, then save. A rejected shortcut keeps the recorder open so the user can try again.
    func capture(_ s: Shortcut) {
        if let p = s.problem { shortcutNote = Shortcut.message(for: p); shortcutNoteIsError = true; return }
        // Try it while still recording; only stop once macOS accepts it, so a refusal lets the user try again at once.
        guard onShortcutChange(s) else {
            shortcutNote = "\(s.display) is already used by another app. Try another."; shortcutNoteIsError = true; return
        }
        shortcutState = .working
        stopRecording()
        shortcutStore.set(s)
        shortcut = s
        shortcutNote = "Saved. Works right now."; shortcutNoteIsError = false
    }

    func resetShortcut() {
        stopRecording()
        guard onShortcutChange(.default) else {
            shortcutNote = "\(Shortcut.default.display) is already used by another app."; shortcutNoteIsError = true; return
        }
        shortcutStore.reset()
        shortcutState = .working
        shortcut = .default
        shortcutNote = "Back to \(Shortcut.default.display)."; shortcutNoteIsError = false
    }

    func test() {
        guard form.isValid else { showProblems = true; return }
        let saved = form.cleanKey.isEmpty ? settings.key(for: form.provider) : ""
        let config = form.config(savedKey: saved, timeoutSeconds: 30)
        testing = true; status = "Testing…"; statusIsError = false
        Task {
            let r = await runTest(config)
            testing = false
            if case .success = r { statusIsError = false } else { statusIsError = true }
            status = SettingsForm.testSummary(r)
        }
    }
}

struct HomeView: View {
    @ObservedObject var model: HomeModel
    @Environment(\.colorScheme) private var scheme
    private var t: Theme { Theme.resolve(scheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(t.edge)
            VStack(alignment: .leading, spacing: 18) {
                running
                accessibility
            }.padding(20)
            Divider().overlay(t.edge)
            settings.padding(20)
            Divider().overlay(t.edge)
            footer.padding(.horizontal, 20).padding(.vertical, 12)
        }
        .frame(width: 480)
        .background(t.surface)
        .foregroundColor(t.text)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Wordmark(theme: t)
            Text("POC — Prompt Optimization Coach").font(Theme.font(15, .semibold))
            Spacer()
        }.padding(.horizontal, 20).padding(.vertical, 14)
    }

    private func heading(_ s: String) -> some View { Text(s).font(Theme.font(12, .medium)).foregroundColor(t.muted) }
    private func body(_ s: String) -> some View { Text(s).font(Theme.font(13)).fixedSize(horizontal: false, vertical: true) }

    private var running: some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("RUNNING")
            HStack(spacing: 7) {
                Circle().fill(t.hue).frame(width: 8, height: 8)
                Text("POC is running.").font(Theme.font(13, .semibold))
            }
            body("It lives in the menu bar at the top of your screen (the “p●c” icon). On a Mac with a notch the icon can hide behind it; this window is the way back in. Open POC again any time to see it.")
            body("To use it: select your draft in any app, then press \(model.shortcut.display).")
        }
    }

    private var accessibility: some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("ACCESSIBILITY")
            HStack(alignment: .top, spacing: 12) {
                body(HomeStatus.accessibilityLine(granted: model.accessibility))
                Spacer(minLength: 8)
                if !model.accessibility {
                    pill("Open Accessibility settings", primary: true) { Permissions.promptAccessibility(); Permissions.openAccessibilitySettings() }
                }
            }
        }
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 12) {
            heading("SETTINGS · WHICH MODEL SHOULD POC USE?")
            row("Provider") {
                Picker("", selection: Binding(get: { model.form.provider }, set: { model.pick(provider: $0) })) {
                    ForEach(CoachSettings.providers, id: \.id) { Text($0.name).tag($0.id) }
                }.labelsHidden()
            }
            row("Model") {
                TextField(model.form.canBeAutomatic ? "Automatic (first model the server lists)" : "Default for this provider", text: $model.form.model)
                    .textFieldStyle(.roundedBorder)
            }
            if model.form.usesBaseUrl {
                row("Server address") {
                    TextField("http://localhost:1234/v1", text: $model.form.baseUrl).textFieldStyle(.roundedBorder)
                }
            }
            if model.form.needsKey {
                row("API key") {
                    SecureField(model.form.hasSavedKey ? "Saved in Keychain — leave blank to keep" : "Paste your API key", text: $model.form.typedKey)
                        .textFieldStyle(.roundedBorder)
                }
            }
            row("Shortcut") {
                HStack(spacing: 10) {
                    Button { model.recording ? model.stopRecording() : model.startRecording() } label: {
                        Text(model.recording ? "Press keys…" : model.shortcut.display)
                            .font(Theme.font(13, .medium))
                            .frame(minWidth: 84)
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .foregroundColor(model.recording ? t.onPrimary : t.text)
                            .background(model.recording ? t.hue : t.raised)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
                    }.buttonStyle(.plain)
                    pill("Reset to \(Shortcut.default.display)") { model.resetShortcut() }
                        .disabled(model.shortcut == .default && !model.recording)
                    Spacer()
                }
            }
            if !model.shortcutNote.isEmpty {
                Text(model.shortcutNote).font(Theme.font(12)).foregroundColor(model.shortcutNoteIsError ? t.negative : t.muted)
                    .padding(.leading, 106)
            } else if let taken = model.shortcutState.note(for: model.shortcut) {
                Text(taken).font(Theme.font(12)).foregroundColor(t.negative).padding(.leading, 106)
            }
            if model.showProblems {
                ForEach(model.form.problems, id: \.self) { Text(SettingsForm.message(for: $0)).font(Theme.font(12)).foregroundColor(t.negative) }
            }
            Text(model.form.needsKey ? "Your key goes to your Keychain and to the provider, nowhere else."
                                     : "This provider needs no key. Ollama runs on this Mac.")
                .font(Theme.font(12)).foregroundColor(t.muted)
            HStack(spacing: 10) {
                pill("Save", primary: true) { model.save() }
                pill(model.testing ? "Testing…" : "Test") { model.test() }.disabled(model.testing)
                Text(model.status).font(Theme.font(12)).foregroundColor(model.statusIsError ? t.negative : t.muted)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                Spacer()
            }
        }
    }

    private var footer: some View {
        HStack {
            Text("Closing this window leaves POC running.").font(Theme.font(12)).foregroundColor(t.muted)
            Spacer()
            pill("Quit POC") { model.onQuit() }
        }
    }

    private func row<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        HStack(spacing: 10) {
            Text(label).font(Theme.font(13)).foregroundColor(t.muted).frame(width: 96, alignment: .trailing)
            content()
        }
    }

    private func pill(_ title: String, primary: Bool = false, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(Theme.font(13, .medium))
                .padding(.horizontal, 12).padding(.vertical, 6)
                .foregroundColor(primary ? t.onPrimary : t.text)
                .background(primary ? t.primary : t.raised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
        }.buttonStyle(.plain)
    }
}

/// The window itself. One instance, shown on launch and every reopen; closing it only hides it.
@MainActor
final class HomeWindowController {
    let model: HomeModel
    private var window: NSWindow?
    private var timer: Timer?

    init(model: HomeModel) { self.model = model }

    var isVisible: Bool { window?.isVisible ?? false }

    func show(reloadSettings: Bool = false) {
        if window == nil {
            let host = NSHostingView(rootView: HomeView(model: model))
            let w = NSWindow(contentRect: NSRect(origin: .zero, size: host.fittingSize), styleMask: [.titled, .closable, .miniaturizable],
                             backing: .buffered, defer: false)
            w.title = "POC — Prompt Optimization Coach"
            w.contentView = host
            w.isReleasedWhenClosed = false
            w.center()
            window = w
        }
        if reloadSettings { model.reloadForm() }
        model.refreshAccessibility()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.window?.isVisible == true { self.model.refreshAccessibility() } else { self.timer?.invalidate() }
            }
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        window?.orderFrontRegardless()
    }

    func hide() { window?.orderOut(nil) }

    /// Light and dark PNGs of the window for the screenshots folder (never shown on screen).
    func render(to name: String, hasKeyState: Bool) {
        let host = NSHostingView(rootView: HomeView(model: model))
        for scheme in [NSAppearance.Name.darkAqua, .aqua] {
            host.appearance = NSAppearance(named: scheme)
            host.frame = NSRect(origin: .zero, size: host.fittingSize)
            host.layoutSubtreeIfNeeded()
            Debug.snapshot(host, name: "\(name)-\(scheme == .darkAqua ? "dark" : "light")")
        }
    }
}
