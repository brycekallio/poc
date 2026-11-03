import AppKit
import POCCore

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // menu-bar only: no Dock icon, never steals focus
app.run()
