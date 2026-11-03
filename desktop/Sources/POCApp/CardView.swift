import SwiftUI
import POCCore

/// What the card is showing.
enum CardState: Equatable {
    case coach(CoachCardState)
    case message(title: String, detail: String, action: CardAction?)
    case result(text: String, ok: Bool)
}
enum CardAction: Equatable { case openAccessibility }

struct CoachCardState: Equatable {
    var step: CoachSession.Step
    var draft: String
    var app: String
    var selectionLost: Bool
}

final class CardModel: ObservableObject {
    @Published var state: CardState
    var onUse: () -> Void = {}
    var onClose: () -> Void = {}
    var onAction: (CardAction) -> Void = { _ in }
    var onChoose: (String?) -> Void = { _ in }
    var onBack: () -> Void = {}
    var onChangeAnswers: () -> Void = {}
    var onRewrite: () -> Void = {}
    var onRetry: () -> Void = {}
    var onLeaveResult: () -> Void = {}
    var onOpenSettings: () -> Void = {}
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
    @State private var own = ""
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
            if case let .coach(c) = model.state {
                if case let .question(_, index, total, _) = c.step, total > 1 {
                    Text("\(index + 1) of \(total)").font(Theme.font(12)).foregroundColor(t.muted)
                } else {
                    Text(c.app).font(Theme.font(12)).foregroundColor(t.muted).lineLimit(1)
                }
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
        case let .coach(c): coachContent(c)
        case let .message(title, detail, action):
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(Theme.font(14, .medium))
                Text(detail).font(Theme.font(13)).foregroundColor(t.muted).lineSpacing(3)
                if let action {
                    primary("Open Accessibility settings") { model.onAction(action) }.padding(.top, 4)
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

    // MARK: Coaching steps (the extension's views: loading, question, summary, rewriting, result, error)

    @ViewBuilder private func coachContent(_ c: CoachCardState) -> some View {
        switch c.step {
        case .asking:
            VStack(alignment: .leading, spacing: 10) {
                bars([62, 100, 78]); VStack(spacing: 6) { bar(34); bar(34); bar(34) }
                status("Reading your draft…")
            }
        case let .question(q, index, _, chosen):
            VStack(alignment: .leading, spacing: 10) {
                if !q.quote.isEmpty {
                    HStack(alignment: .top, spacing: 8) {
                        Rectangle().fill(t.hue).frame(width: 2)
                        Text(q.quote).font(Theme.font(12)).foregroundColor(t.muted).lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }.fixedSize(horizontal: false, vertical: true)
                }
                Text(q.question).font(Theme.font(14, .medium)).fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 6) {
                    ForEach(Array(q.options.enumerated()), id: \.offset) { i, option in
                        optionRow(number: i + 1, text: option, selected: chosen == option) { model.onChoose(option) }
                    }
                }
                HStack(spacing: 6) {
                    TextField("or write my own", text: $own)
                        .textFieldStyle(.plain).font(Theme.font(13))
                        .padding(.horizontal, 9).frame(height: 30)
                        .background(t.surface)
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous).stroke(t.edge, lineWidth: 1))
                        .onSubmit { submitOwn() }
                    if !own.trimmingCharacters(in: .whitespaces).isEmpty { primary("Use") { submitOwn() } }
                }
                HStack {
                    if index > 0 { link("Back") { model.onBack() } }
                    Spacer()
                    link("Skip") { own = ""; model.onChoose(nil) }
                    Text("1–\(min(q.options.count, 9)) to pick · esc closes").font(Theme.font(12)).foregroundColor(t.muted)
                }
            }
        case let .summary(rows):
            VStack(alignment: .leading, spacing: 10) {
                Text(rows.isEmpty ? "Nothing to ask. This draft already says what it needs to, so the rewrite only tightens it."
                                  : "Got it. Here is what the rewrite will use.")
                    .font(Theme.font(13)).foregroundColor(t.muted).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.question).font(Theme.font(12)).foregroundColor(t.muted)
                        Text(r.answer ?? "Skipped").font(Theme.font(13)).foregroundColor(r.answer == nil ? t.muted : t.text)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack {
                    if !rows.isEmpty { link("Change answers") { own = ""; model.onChangeAnswers() } }
                    Spacer()
                    primary("Rewrite") { model.onRewrite() }
                    Text("or return").font(Theme.font(12)).foregroundColor(t.muted)
                }
            }
        case let .rewriting(partial):
            VStack(alignment: .leading, spacing: 10) {
                if partial.isEmpty { bars([92, 100, 84, 96, 60]) }
                else { rewriteBox(partial) }
                status("Rewriting with your answers…")
            }
        case let .result(r):
            VStack(alignment: .leading, spacing: 10) {
                rewriteBox(r.prompt)
                if !r.techniques.isEmpty {
                    Text(r.techniques.joined(separator: " · ")).font(Theme.font(12)).foregroundColor(t.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !r.unverified.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Read this one before using it. It still misses:").font(Theme.font(12, .medium))
                        ForEach(r.unverified, id: \.self) { Text("• \($0)").font(Theme.font(12)).fixedSize(horizontal: false, vertical: true) }
                    }
                    .foregroundColor(t.negative)
                }
                if c.selectionLost {
                    Text("Your selection changed, so this will copy the rewrite instead.").font(Theme.font(12)).foregroundColor(t.negative)
                }
                HStack {
                    link("Back") { model.onLeaveResult() }
                    Spacer()
                    Text("or return").font(Theme.font(12)).foregroundColor(t.muted)
                    primary(c.selectionLost ? "Copy" : "Use this") { model.onUse() }
                }
            }
        case let .error(f):
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.circle").font(.system(size: 13)).foregroundColor(t.negative)
                    Text(f.message).font(Theme.font(13)).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                }
                if f.needsSettings { primary("Open settings") { model.onOpenSettings() } }
                else { primary("Try again") { model.onRetry() } }
            }
        }
    }

    private func submitOwn() {
        let text = own.trimmingCharacters(in: .whitespacesAndNewlines)
        own = ""
        model.onChoose(text.isEmpty ? nil : text)
    }

    // MARK: Pieces

    private func rewriteBox(_ text: String) -> some View {
        ScrollView {
            Text(text).font(Theme.font(13)).lineSpacing(3).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading).padding(10)
        }
        .frame(maxHeight: 190)
        .fixedSize(horizontal: false, vertical: true)
        .background(t.raised)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
    }

    private func optionRow(number: Int, text: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text("\(number)").font(Theme.font(11, .medium)).foregroundColor(t.muted).frame(width: 12)
                Text(text).font(Theme.font(13)).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if selected { Image(systemName: "checkmark").font(.system(size: 10, weight: .semibold)).foregroundColor(t.hue) }
            }
            .padding(.horizontal, 10).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading)
            .background(t.raised).contentShape(Rectangle())
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
        }.buttonStyle(.plain)
    }

    private func primary(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(Theme.font(13, .medium)).foregroundColor(t.onPrimary)
                .padding(.horizontal, 14).frame(height: 30).background(t.primary)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
        }.buttonStyle(.plain)
    }

    private func link(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(Theme.font(12, .medium)).foregroundColor(t.muted) }.buttonStyle(.plain)
    }

    private func status(_ text: String) -> some View {
        Text(text).font(Theme.font(12)).foregroundColor(t.muted).accessibilityAddTraits(.updatesFrequently)
    }

    private func bar(_ height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous).fill(t.raised).frame(height: height)
    }

    private func bars(_ widths: [CGFloat]) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(widths.enumerated()), id: \.offset) { _, w in
                GeometryReader { g in
                    RoundedRectangle(cornerRadius: 3, style: .continuous).fill(t.raised).frame(width: g.size.width * w / 100, height: 10)
                }.frame(height: 10)
            }
        }.accessibilityHidden(true)
    }
}
