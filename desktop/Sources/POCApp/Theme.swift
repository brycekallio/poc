import SwiftUI
import AppKit

/// The extension's card look (extension/src/panel.css): achromatic ink and greys, one blue hue,
/// 10 px card, 7 px controls, Geist type. Light and dark values copied from the CSS variables.
struct Theme {
    let surface, raised, text, muted, primary, onPrimary, hue, edge, negative: Color

    static func resolve(_ scheme: ColorScheme) -> Theme {
        scheme == .dark
        ? Theme(surface: Color(hex: 0x171717), raised: Color(hex: 0x242424), text: Color(hex: 0xFAFAFA), muted: Color(hex: 0xA8A8A8),
                primary: Color(hex: 0xFAFAFA), onPrimary: Color(hex: 0x0A0A0A), hue: Color(hex: 0x6EA2F0), edge: Color(hex: 0x2E2E2E), negative: Color(hex: 0xE5566F))
        : Theme(surface: .white, raised: Color(hex: 0xF2F2F2), text: Color(hex: 0x0A0A0A), muted: Color(hex: 0x6B6B6B),
                primary: Color(hex: 0x141414), onPrimary: .white, hue: Color(hex: 0x1D5FBF), edge: Color(hex: 0xE4E4E4), negative: Color(hex: 0xC4242A))
    }

    static let radius: CGFloat = 10
    static let radiusControl: CGFloat = 7

    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .semibold, .bold: name = "Geist-SemiBold"
        case .medium: name = "Geist-Medium"
        default: name = "Geist-Regular"
        }
        return NSFont(name: name, size: size) != nil ? .custom(name, size: size) : .system(size: size, weight: weight)
    }

    /// Geist ships inside the app bundle (SIL OFL, licence beside the files).
    static func registerFonts() {
        guard let dir = Bundle.main.resourceURL?.appendingPathComponent("fonts"),
              let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
        for f in files where f.pathExtension == "ttf" { CTFontManagerRegisterFontsForURL(f as CFURL, .process, nil) }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}
