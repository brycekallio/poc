import Foundation

/// One coaching session per draft: ask → answer → rewrite → use. The Swift twin of the
/// transitions in extension/src/session.js (the prompts, schemas and checks behind it are the
/// shared JS; only this small state machine lives on both sides).
@MainActor
public final class CoachSession {
    public enum Step: Equatable {
        /// Call 1 is running.
        case asking
        /// One question at a time. `chosen` is the answer already given, when going back.
        case question(CoachQuestion, index: Int, total: Int, chosen: String?)
        /// All answered (or nothing to ask): the Rewrite button.
        case summary([QA])
        /// Call 2 is running; `partial` is the rewrite so far.
        case rewriting(partial: String)
        case result(RewriteResult)
        case error(CoachFailure)
    }
    public struct QA: Equatable {
        public let question: String; public let answer: String?
        public init(question: String, answer: String?) { self.question = question; self.answer = answer }
    }

    public private(set) var step: Step = .asking { didSet { onChange() } }
    public var onChange: () -> Void = {}

    private let engine: CoachEngine
    private let config: () -> CoachConfig
    public let draft: String
    private let host: String

    private var questions: [CoachQuestion] = []
    private var answers: [String: String?] = [:]
    private var index = 0
    private var reader: Reader = .ai
    private var failed: Failed = .ask
    private enum Failed { case ask, rewrite }
    private var run = 0
    private var task: Task<Void, Never>?

    /// `config` is read at the moment of each call, so the key is fetched from the Keychain then
    /// and not held here.
    public init(engine: CoachEngine, config: @escaping () -> CoachConfig, draft: String, host: String) {
        self.engine = engine; self.config = config
        self.draft = draft.trimmingCharacters(in: .whitespacesAndNewlines); self.host = host
    }

    // MARK: Intents

    /// Call 1: the questions.
    public func start() {
        failed = .ask
        launch(pending: .asking) { [self] token in
            let result = await engine.diagnose(config: config(), draft: draft, host: host)
            guard run == token else { return }
            switch result {
            case let .success(d):
                questions = d.questions; reader = d.reader; answers = [:]; index = 0
                step = currentQuestionStep()
            case let .failure(f): fail(f)
            }
        }
    }

    /// Answer the current question (nil skips it) and move on.
    public func choose(_ answer: String?) {
        guard case let .question(q, _, _, _) = step else { return }
        let trimmed = answer?.trimmingCharacters(in: .whitespacesAndNewlines)
        answers[q.id] = (trimmed?.isEmpty ?? true) ? nil : trimmed
        index += 1
        step = currentQuestionStep()
    }

    public func back() {
        guard case .question = step, index > 0 else { return }
        index -= 1
        step = currentQuestionStep()
    }

    /// From the summary back to question 1.
    public func changeAnswers() {
        guard case .summary = step, !questions.isEmpty else { return }
        index = 0
        step = currentQuestionStep()
    }

    /// Call 2: the rewrite.
    public func rewrite() {
        guard case .summary = step else { return }
        failed = .rewrite
        let given = qa().map { Answer(question: $0.question, answer: $0.answer) }
        launch(pending: .rewriting(partial: "")) { [self] token in
            let box = self
            let result = await engine.rewrite(config: config(), draft: draft, answers: given, reader: reader, host: host) { text in
                Task { @MainActor in
                    guard box.run == token, case .rewriting = box.step else { return }
                    box.step = .rewriting(partial: text)
                }
            }
            guard run == token else { return }
            switch result {
            case let .success(r): step = .result(r)
            case let .failure(f): fail(f)
            }
        }
    }

    /// "Try again" repeats whichever call failed. A failed rewrite keeps the answers.
    public func retry() {
        guard case .error = step else { return }
        switch failed {
        case .ask: start()
        case .rewrite: step = .summary(qa()); rewrite()
        }
    }

    /// From the result back to the summary.
    public func leaveResult() {
        guard case .result = step else { return }
        step = .summary(qa())
    }

    /// The card was closed: stop the model call and ignore anything still in flight.
    public func cancel() {
        run += 1
        task?.cancel()
        engine.cancel()
    }

    /// What Use pastes back: the rewrite, exactly, and only once there is one.
    public var textToPaste: String? {
        if case let .result(r) = step { return r.prompt }
        return nil
    }

    /// Resolves when no model call is running (for tests).
    public func settled() async { await task?.value }

    // MARK: Internals

    private func launch(pending: Step, _ body: @escaping (Int) async -> Void) {
        run += 1
        let token = run
        step = pending
        task = Task { await body(token) }
    }

    private func fail(_ f: CoachFailure) {
        // A cancelled call is the user closing the card; there is nothing to show.
        if f.isCancellation { return }
        step = .error(f)
    }

    private func qa() -> [QA] {
        questions.map { QA(question: $0.question, answer: answers[$0.id] ?? nil) }
    }

    private func currentQuestionStep() -> Step {
        guard index < questions.count else { return .summary(qa()) }
        let q = questions[index]
        return .question(q, index: index, total: questions.count, chosen: answers[q.id] ?? nil)
    }
}
