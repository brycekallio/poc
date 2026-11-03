import XCTest
import AppKit
@testable import POCCore

// Fakes. The pasteboard is a private named one, so tests never touch the real clipboard.
final class FakeAX: AccessibilitySource {
    var selected: String?
    var field: String?
    var onField: (() -> Void)?
    func selectedText() -> String? { selected }
    func fieldText() -> String? { onField?(); return field }
}
final class FakeKeys: KeyPoster {
    let pb: NSPasteboard
    var copyProduces: String?          // what ⌘C puts on the clipboard (nil = nothing selected)
    var pasteInto: ((String) -> Void)? // what ⌘V does with the clipboard text
    var copies = 0, pastes = 0
    init(_ pb: NSPasteboard) { self.pb = pb }
    func postCopy() {
        copies += 1
        if let t = copyProduces { pb.clearContents(); pb.setString(t, forType: .string) }
    }
    func postPaste() {
        pastes += 1
        if let t = pb.string(forType: .string) { pasteInto?(t) }
    }
}
struct FakeSecure: SecureInputProbe { var isSecureInputOn: Bool }

func privateBoard() -> NSPasteboard {
    let pb = NSPasteboard(name: NSPasteboard.Name("poc.test.\(UUID().uuidString)"))
    pb.clearContents()
    return pb
}
func pngData() -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 4, pixelsHigh: 4, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    return rep.representation(using: .png, properties: [:])!
}

final class PasteboardSnapshotTests: XCTestCase {
    func testRestoresTextAndImageTogether() {
        let pb = privateBoard()
        let item = NSPasteboardItem()
        item.setString("hello", forType: .string)
        item.setData(pngData(), forType: .png)
        pb.writeObjects([item])
        let snap = PasteboardSnapshot(of: pb)
        pb.clearContents(); pb.setString("something else", forType: .string)
        snap.restore(to: pb)
        XCTAssertEqual(pb.string(forType: .string), "hello")
        XCTAssertEqual(pb.data(forType: .png), pngData())
    }
    func testEmptyClipboardRestoresToEmpty() {
        let pb = privateBoard()
        let snap = PasteboardSnapshot(of: pb)
        XCTAssertTrue(snap.isEmpty)
        pb.setString("x", forType: .string)
        snap.restore(to: pb)
        XCTAssertNil(pb.string(forType: .string))
    }
    func testRestoresMultipleItems() {
        let pb = privateBoard()
        let a = NSPasteboardItem(); a.setString("one", forType: .string)
        let b = NSPasteboardItem(); b.setString("two", forType: .string)
        pb.writeObjects([a, b])
        let snap = PasteboardSnapshot(of: pb)
        pb.clearContents()
        snap.restore(to: pb)
        XCTAssertEqual(pb.pasteboardItems?.count, 2)
    }
}

final class SelectionReaderTests: XCTestCase {
    func reader(_ ax: FakeAX, _ keys: FakeKeys, secure: Bool = false) -> SelectionReader {
        SelectionReader(ax: ax, keys: keys, secure: FakeSecure(isSecureInputOn: secure), pasteboard: keys.pb, copyTimeout: 0.1)
    }
    func testAccessibilityWinsAndNeverTouchesClipboard() {
        let pb = privateBoard(); pb.setString("mine", forType: .string)
        let ax = FakeAX(); ax.selected = "draft"
        let keys = FakeKeys(pb)
        XCTAssertEqual(reader(ax, keys).read(), .text("draft", via: .accessibility))
        XCTAssertEqual(keys.copies, 0)
        XCTAssertEqual(pb.string(forType: .string), "mine")
    }
    func testFallsBackToCopyAndRestoresClipboardIncludingImage() {
        let pb = privateBoard()
        let item = NSPasteboardItem(); item.setData(pngData(), forType: .png); item.setString("old", forType: .string)
        pb.writeObjects([item])
        let ax = FakeAX()  // AX says nothing
        let keys = FakeKeys(pb); keys.copyProduces = "copied draft"
        XCTAssertEqual(reader(ax, keys).read(), .text("copied draft", via: .copy))
        XCTAssertEqual(pb.string(forType: .string), "old")
        XCTAssertEqual(pb.data(forType: .png), pngData())
    }
    func testWhitespaceOnlyAxFallsThroughToCopy() {
        let pb = privateBoard()
        let ax = FakeAX(); ax.selected = "   \n"
        let keys = FakeKeys(pb); keys.copyProduces = "real"
        XCTAssertEqual(reader(ax, keys).read(), .text("real", via: .copy))
    }
    func testNothingSelectedAnywhere() {
        let pb = privateBoard(); pb.setString("keep", forType: .string)
        let keys = FakeKeys(pb)  // ⌘C changes nothing
        XCTAssertEqual(reader(FakeAX(), keys).read(), .nothingSelected)
        XCTAssertEqual(pb.string(forType: .string), "keep")
    }
    func testSecureInputIsReportedNotAttempted() {
        let pb = privateBoard()
        let keys = FakeKeys(pb); keys.copyProduces = "x"
        XCTAssertEqual(reader(FakeAX(), keys, secure: true).read(), .secureInput)
        XCTAssertEqual(keys.copies, 0)
    }
}

final class WriteBackTests: XCTestCase {
    func writer(_ ax: FakeAX, _ keys: FakeKeys, secure: Bool = false) -> WriteBack {
        WriteBack(ax: ax, keys: keys, secure: FakeSecure(isSecureInputOn: secure), pasteboard: keys.pb, settle: 0.1, restoreDelay: 0)
    }
    func testVerifiedPasteRestoresClipboard() {
        let pb = privateBoard(); pb.setString("my clipboard", forType: .string)
        let ax = FakeAX(); ax.field = "old draft"
        let keys = FakeKeys(pb); keys.pasteInto = { ax.field = $0 }
        XCTAssertEqual(writer(ax, keys).write("NEW REWRITE"), .pasted)
        XCTAssertEqual(pb.string(forType: .string), "my clipboard")
    }
    func testLatePasteStillCounts() {  // async editors update after the keystroke
        let pb = privateBoard()
        let ax = FakeAX(); ax.field = "old"
        var reads = 0
        ax.onField = { reads += 1; if reads == 4 { ax.field = "NEW" } }
        let keys = FakeKeys(pb)
        XCTAssertEqual(writer(ax, keys).write("NEW"), .pasted)
    }
    func testPasteIgnoredLeavesRewriteOnClipboard() {
        let pb = privateBoard(); pb.setString("mine", forType: .string)
        let ax = FakeAX(); ax.field = "old draft"
        let keys = FakeKeys(pb)  // editor ignores the paste
        XCTAssertEqual(writer(ax, keys).write("REWRITE"), .copiedOnly)
        XCTAssertEqual(pb.string(forType: .string), "REWRITE")
    }
    func testUnreadableAppIsUnverifiedAndKeepsRewriteOnClipboard() {
        let pb = privateBoard()
        let ax = FakeAX()  // field never readable
        let keys = FakeKeys(pb)
        XCTAssertEqual(writer(ax, keys).write("REWRITE"), .unverified)
        XCTAssertEqual(pb.string(forType: .string), "REWRITE")
        XCTAssertEqual(keys.pastes, 1)
    }
    func testSecureInputSendsNothing() {
        let pb = privateBoard()
        let keys = FakeKeys(pb)
        XCTAssertEqual(writer(FakeAX(), keys, secure: true).write("R"), .blockedBySecureInput)
        XCTAssertEqual(keys.pastes, 0)
        XCTAssertEqual(pb.string(forType: .string), "R")
    }
    func testEditorReflowingWhitespaceStillMatches() {
        XCTAssertTrue(WriteBack.contains("Line one\n\n  Line   two", "line one line two"))
        XCTAssertFalse(WriteBack.contains("something else", "line one"))
        XCTAssertFalse(WriteBack.contains(nil, "x"))
        XCTAssertFalse(WriteBack.contains("anything", ""))
    }
}

final class PanelPlacementTests: XCTestCase {
    let screen = CGRect(x: 0, y: 25, width: 1440, height: 875)
    let panel = CGSize(width: 340, height: 200)
    func testBelowSelection() {
        let p = PanelPlacement.origin(panel: panel, selection: CGRect(x: 100, y: 300, width: 200, height: 18), screen: screen)
        XCTAssertEqual(p, CGPoint(x: 100, y: 326))
    }
    func testFlipsAboveWhenNoRoomBelow() {
        let p = PanelPlacement.origin(panel: panel, selection: CGRect(x: 100, y: 800, width: 200, height: 18), screen: screen)
        XCTAssertEqual(p.y, 800 - 8 - 200)
    }
    func testClampedToRightEdge() {
        let p = PanelPlacement.origin(panel: panel, selection: CGRect(x: 1400, y: 300, width: 30, height: 18), screen: screen)
        XCTAssertEqual(p.x, 1440 - 12 - 340)
    }
    func testNoRectangleCentresUnderMenuBar() {
        let p = PanelPlacement.origin(panel: panel, selection: nil, screen: screen)
        XCTAssertEqual(p, CGPoint(x: 550, y: 105))
    }
    func testSecondScreenOffsetOrigin() {
        let s2 = CGRect(x: 1440, y: 0, width: 1920, height: 1080)
        let p = PanelPlacement.origin(panel: panel, selection: CGRect(x: 1500, y: 100, width: 50, height: 18), screen: s2)
        XCTAssertEqual(p.x, 1500)
    }
}
