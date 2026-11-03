import AppKit
import POCCore

let app = NSApplication.shared
let delegate = MainActor.assumeIsolated { AppDelegate() }  // top-level code runs on the main thread
app.delegate = delegate
app.setActivationPolicy(.accessory)   // menu-bar only: no Dock icon, never steals focus
app.run()
