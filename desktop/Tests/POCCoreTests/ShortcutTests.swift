import XCTest
@testable import POCCore

final class ShortcutTests: XCTestCase {
    func testDefaultIsControlOptionP() {
        XCTAssertEqual(Shortcut.default.display, "⌃⌥P")
        XCTAssertTrue(Shortcut.default.isValid)
    }

    func testRejectsBareAndShiftOnly() {
        XCTAssertEqual(Shortcut(keyCode: 35, modifiers: []).problem, .needsModifier)
        XCTAssertEqual(Shortcut(keyCode: 35, modifiers: [.shift]).problem, .needsModifier)
    }

    func testRefusesChromeExtensionShortcut() {
        XCTAssertEqual(Shortcut(keyCode: 35, modifiers: [.command, .shift]).problem, .reserved)
        XCTAssertTrue(Shortcut(keyCode: 35, modifiers: [.command]).isValid)
        XCTAssertTrue(Shortcut(keyCode: 35, modifiers: [.command, .shift, .option]).isValid)
    }

    func testUnsupportedKey() {
        XCTAssertEqual(Shortcut(keyCode: 82, modifiers: [.control]).problem, .unsupportedKey)  // keypad 0
    }

    func testDisplayOrder() {
        XCTAssertEqual(Shortcut(keyCode: 49, modifiers: [.command, .shift, .control, .option]).display, "⌃⌥⇧⌘Space")
        XCTAssertEqual(Shortcut(keyCode: 111, modifiers: [.command]).display, "⌘F12")
    }

    func testMenuCharacter() {
        XCTAssertEqual(Shortcut.default.menuCharacter, "p")
        XCTAssertNil(Shortcut(keyCode: 111, modifiers: [.command]).menuCharacter)
    }

    func testStorePersistsAndResets() {
        let d = UserDefaults(suiteName: "poc.shortcut.\(UUID().uuidString)")!
        let store = ShortcutStore(defaults: d)
        XCTAssertEqual(store.current, .default)
        let mine = Shortcut(keyCode: 0, modifiers: [.control, .command])
        XCTAssertNil(store.set(mine))
        XCTAssertEqual(ShortcutStore(defaults: d).current, mine)
        XCTAssertEqual(store.set(Shortcut(keyCode: 0, modifiers: [])), .needsModifier)
        XCTAssertEqual(store.current, mine)   // invalid change left it alone
        store.reset()
        XCTAssertEqual(store.current, .default)
    }

    func testCorruptStoredValueFallsBack() {
        let d = UserDefaults(suiteName: "poc.shortcut.\(UUID().uuidString)")!
        d.set(35, forKey: "shortcut.keyCode"); d.set(0, forKey: "shortcut.modifiers")
        XCTAssertEqual(ShortcutStore(defaults: d).current, .default)
    }
}
