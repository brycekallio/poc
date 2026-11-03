import SwiftUI

/// What the card is showing. Slice 1 has no model call, so there is no question step yet.
enum CardState: Equatable {
    case ready(draft: String, rewrite: String, app: String, via: String, selectionLost: Bool)
    case message(title: String, detail: String, action: CardAction?)
    case result(text: String, ok: Bool)
}
enum CardAction: Equatable { case openAccessibility }

final class CardModel: ObservableObject {
    @Published var state: CardState
    var onUse: () -> Void = {}
    var onClose: () -> Void = {}
    var onAction: (CardAction) -> Void = { _ in }
    init(state: CardState) { self.state = state }
}

/// The lowercase "p●c" wordmark from the extension (panel.js `wordmark()`): a blue disc for the O.
struct Wordmark: View {
    let theme: Theme
    var body: some View {
        HStack(spacing: 1.5) {
            Text("p").font(Theme.font(14, .semibold))
            Circle().fill(theme.hue).frame(width: 8, height: 8).padding(.horizontal, 1)
            Text("c").font(Theme.font(14, .semibold))
        }
        .foregroundColor(theme.text)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("P.O.C")
    }
}

struct CardView: View {
    @ObservedObject var model: CardModel
    @Environment(\.colorScheme) private var scheme
    private var t: Theme { Theme.resolve(scheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            bar
            content.padding(.horizontal, 14).padding(.bottom, 14).padding(.top, 2)
        }
        .frame(width: 340)
        .background(t.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(t.edge, lineWidth: 1))
        .foregroundColor(t.text)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var bar: some View {
        HStack(spacing: 7) {
            Wordmark(theme: t)
            Spacer()
            if case .ready(_, _, let app, _, _) = model.state {
                Text(app).font(Theme.font(12)).foregroundColor(t.muted).lineLimit(1)
            }
            Button(action: model.onClose) {
                Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)).foregroundColor(t.muted)
                    .frame(width: 26, height: 26).contentShape(Rectangle())
            }
            .buttonStyle(.plain).accessibilityLabel("Close")
        }
        .padding(.leading, 14).padding(.trailing, 6).frame(height: 38)
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case let .ready(draft, rewrite, _, via, lost):
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 8) {
                    Rectangle().fill(t.hue).frame(width: 2)
                    Text(draft).font(Theme.font(12)).foregroundColor(t.muted).lineSpacing(2)
                        .lineLimit(4).frame(maxWidth: .infinity, alignment: .leading)
                }
                .fixedSize(horizontal: false, vertical: true)
                Text("Preview rewrite").font(Theme.font(14, .medium))
                Text(rewrite).font(Theme.font(13)).lineSpacing(3).lineLimit(8)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(10)
                    .background(t.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
                Text(lost ? "Your selection changed, so Use will copy the rewrite instead."
                          : "Stand-in only: your draft in capitals. The real coach arrives next.")
                    .font(Theme.font(12)).foregroundColor(lost ? t.negative : t.muted)
                HStack {
                    Button(action: model.onUse) {
                        Text(lost ? "Copy" : "Use").font(Theme.font(13, .medium)).foregroundColor(t.onPrimary)
                            .padding(.horizontal, 14).frame(height: 30).background(t.primary)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
                    }.buttonStyle(.plain)
                    Text("or return").font(Theme.font(12)).foregroundColor(t.muted)
                    Spacer()
                    Text("esc to close · \(via)").font(Theme.font(12)).foregroundColor(t.muted)
                }
            }
        case let .message(title, detail, action):
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(Theme.font(14, .medium))
                Text(detail).font(Theme.font(13)).foregroundColor(t.muted).lineSpacing(3)
                if let action {
                    Button(action: { model.onAction(action) }) {
                        Text("Open Accessibility settings").font(Theme.font(13, .medium)).foregroundColor(t.onPrimary)
                            .padding(.horizontal, 14).frame(height: 30).background(t.primary)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
                    }.buttonStyle(.plain).padding(.top, 4)
                }
            }
        case let .result(text, ok):
            HStack(spacing: 8) {
                Image(systemName: ok ? "checkmark" : "doc.on.clipboard").font(.system(size: 11, weight: .semibold))
                    .foregroundColor(ok ? t.hue : t.muted)
                Text(text).font(Theme.font(13))
            }
        }
    }
}
