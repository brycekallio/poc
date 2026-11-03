import AppKit
import POCCore

/// A plain alert with the four model settings, until the real Settings window (slice 3).
/// The key goes straight to the Keychain; it is never shown again (a blank field keeps the saved one).
enum SettingsDialog {
    @MainActor static func run(settings: CoachSettings) {
        let providers = CoachSettings.providers
        let alert = NSAlert()
        alert.messageText = "Which model should POC use?"
        alert.informativeText = "Ollama runs on this Mac and needs no key. Other providers need your own API key; it is stored in your Keychain and goes nowhere else."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        let popup = NSPopUpButton(frame: .zero, pullsDown: false)
        popup.addItems(withTitles: providers.map(\.name))
        popup.selectItem(at: providers.firstIndex { $0.id == settings.provider } ?? 0)
        let model = NSTextField(string: settings.model(for: settings.provider))
        model.placeholderString = "Automatic (first model the server lists)"
        let base = NSTextField(string: settings.baseUrl)
        base.placeholderString = "Only for “Other”, e.g. http://localhost:1234/v1"
        let key = NSSecureTextField()

        func refresh() {
            let p = providers[popup.indexOfSelectedItem]
            model.stringValue = settings.model(for: p.id)
            let saved = !settings.key(for: p.id).isEmpty
            key.isEnabled = p.needsKey
            key.stringValue = ""
            key.placeholderString = p.needsKey ? (saved ? "Saved in Keychain — leave blank to keep" : "Paste your API key") : "Not needed"
            base.isEnabled = p.usesBaseUrl
        }
        let handler = PopupTarget(refresh)
        popup.target = handler; popup.action = #selector(PopupTarget.changed)
        refresh()

        let rows: [(String, NSView)] = [("Provider", popup), ("Model", model), ("Server address", base), ("API key", key)]
        let grid = NSGridView(views: rows.map { [label($0.0), $0.1] })
        grid.rowSpacing = 8; grid.columnSpacing = 10
        grid.column(at: 1).width = 300
        grid.frame = NSRect(x: 0, y: 0, width: 380, height: 28 * CGFloat(rows.count) + 8 * CGFloat(rows.count - 1))
        alert.accessoryView = grid

        NSApp.activate(ignoringOtherApps: true)
        let answer = alert.runModal()
        withExtendedLifetime(handler) {}
        guard answer == .alertFirstButtonReturn else { return }
        let chosen = providers[popup.indexOfSelectedItem]
        settings.provider = chosen.id
        settings.setModel(model.stringValue.trimmingCharacters(in: .whitespaces), for: chosen.id)
        if chosen.usesBaseUrl { settings.baseUrl = base.stringValue.trimmingCharacters(in: .whitespaces) }
        let newKey = key.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if chosen.needsKey, !newKey.isEmpty {
            do { try settings.setKey(newKey, for: chosen.id) }
            catch {
                let fail = NSAlert()
                fail.messageText = "Couldn't save the key to your Keychain"
                fail.informativeText = "macOS said: \(error). The key was not stored anywhere else."
                fail.runModal()
            }
        }
    }

    private static func label(_ s: String) -> NSTextField {
        let l = NSTextField(labelWithString: s)
        l.alignment = .right
        return l
    }

    private final class PopupTarget: NSObject {
        let run: () -> Void
        init(_ run: @escaping () -> Void) { self.run = run }
        @objc func changed() { run() }
    }
}
