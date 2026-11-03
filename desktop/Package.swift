// swift-tools-version:5.9
import PackageDescription

// POCCore = the Mac plumbing with no UI (clipboard, selection decision logic, write-back, placement),
// so `swift test` can cover it. POCApp = the menu-bar app that wires it to real macOS.
let package = Package(
    name: "POC",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "POCCore"),
        .executableTarget(name: "POCApp", dependencies: ["POCCore"]),
        .testTarget(name: "POCCoreTests", dependencies: ["POCCore"]),
    ]
)
