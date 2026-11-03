// swift-tools-version:5.9
import PackageDescription

// POCCore = the Mac plumbing with no UI (clipboard, selection decision logic, write-back, placement),
// so `swift test` can cover it. POCApp = the menu-bar app that wires it to real macOS.
let package = Package(
    name: "POC",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "POCCore"),
        // POCEngine = the hidden web view that runs the extension's coaching JavaScript (WebKit, no UI).
        .target(name: "POCEngine", dependencies: ["POCCore"]),
        .executableTarget(name: "POCApp", dependencies: ["POCCore", "POCEngine"]),
        // Headless: one real coaching round against the configured model, with timings. Touches no other app.
        .executableTarget(name: "POCHarness", dependencies: ["POCCore", "POCEngine"]),
        .testTarget(name: "POCCoreTests", dependencies: ["POCCore"]),
        .testTarget(name: "POCEngineTests", dependencies: ["POCCore", "POCEngine"]),
    ]
)
