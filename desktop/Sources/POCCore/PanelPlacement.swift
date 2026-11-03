import CoreGraphics

/// Where the panel goes. All rectangles are in *screen* coordinates with the origin at the
/// top-left and y growing downward (what the accessibility API reports), so no flipping in here.
public enum PanelPlacement {
    public static let gap: CGFloat = 8
    public static let margin: CGFloat = 12

    /// Below the selection if it fits, otherwise above; clamped inside `screen`.
    /// With no selection rectangle (the app didn't report one), top-centre under the menu bar.
    public static func origin(panel: CGSize, selection: CGRect?, screen: CGRect) -> CGPoint {
        guard let sel = selection, !sel.isNull, !sel.isInfinite, sel.width >= 0 else {
            return CGPoint(x: screen.midX - panel.width / 2, y: screen.minY + 80)
        }
        var x = sel.minX
        var y = sel.maxY + gap
        if y + panel.height > screen.maxY - margin {      // no room below
            y = sel.minY - gap - panel.height
        }
        x = min(max(x, screen.minX + margin), screen.maxX - margin - panel.width)
        y = min(max(y, screen.minY + margin), screen.maxY - margin - panel.height)
        return CGPoint(x: x, y: y)
    }
}
