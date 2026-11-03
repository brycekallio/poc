import AppKit

/// A full copy of what is on a pasteboard (every item, every type: text, images, files),
/// so the app can borrow the clipboard for ⌘C / ⌘V and give it back untouched.
public struct PasteboardSnapshot {
    private let items: [[NSPasteboard.PasteboardType: Data]]

    public init(of pasteboard: NSPasteboard) {
        items = (pasteboard.pasteboardItems ?? []).map { item in
            var copy: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) { copy[type] = data }
            }
            return copy
        }
    }

    public var isEmpty: Bool { items.isEmpty }

    public func restore(to pasteboard: NSPasteboard) {
        pasteboard.clearContents()
        let restored = items.map { entry -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in entry { item.setData(data, forType: type) }
            return item
        }
        if !restored.isEmpty { pasteboard.writeObjects(restored) }
    }
}
