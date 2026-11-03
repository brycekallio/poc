import AppKit

/// Developer evidence hooks, off unless the environment asks (launch with `open --env POC_DEBUG_DIR=/path`).
/// Used for runs where the screen can't be captured from a script: events go to a log file and the
/// card is rendered to a PNG straight from the view (a render of the real card, not a screen capture).
enum Debug {
    static let dir: URL? = ProcessInfo.processInfo.environment["POC_DEBUG_DIR"].map { URL(fileURLWithPath: $0) }

    static func log(_ line: String) {
        guard let dir else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("poc.log")
        let text = "\(ISO8601DateFormatter().string(from: Date())) \(line)\n"
        if let h = try? FileHandle(forWritingTo: file) { h.seekToEndOfFile(); h.write(Data(text.utf8)); try? h.close() }
        else { try? text.write(to: file, atomically: true, encoding: .utf8) }
    }

    static func snapshot(_ view: NSView, name: String) {
        guard let dir, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("\(name).png"))
    }
}
