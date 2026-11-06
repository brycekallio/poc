import XCTest
import AppKit
@testable import POCCore

/// A scripted stand-in for the model. Each call pops the next scripted result; `gate` lets a test hold a call open.
final class FakeEngine: CoachEngine, @unchecked Sendable {
    var diagnoses: [Result<Diagnosis, CoachFailure>] = []
    var rewrites: [Result<RewriteResult, CoachFailure>] = []
    var partials: [String] = []
    var gate: (() async -> Void)?
    private(set) var diagnoseCalls: [(config: CoachConfig, draft: String, host: String)] = []
    private(set) var rewriteCalls: [(answers: [Answer], reader: Reader, host: String)] = []
    private(set) var cancels = 0

    func diagnose(config: CoachConfig, draft: String, host: String) async -> Result<Diagnosis, CoachFailure> {
        diagnoseCalls.append((config, draft, host))
        await gate?()
        return diagnoses.removeFirst()
    }
    func rewrite(config: CoachConfig, draft: String, answers: [Answer], reader: Reader, host: String,
                 onPartial: @escaping @Sendable (String) -> Void) async -> Result<RewriteResult, CoachFailure> {
        rewriteCalls.append((answers, reader, host))
        for p in partials { onPartial(p) }
        await gate?()
        return rewrites.removeFirst()
    }
    func cancel() { cancels += 1 }
}

private let q1 = CoachQuestion(id: "length", quote: "summary", question: "How long?", options: ["One page", "Three bullets"])
private let q2 = CoachQuestion(id: "who", quote: "", question: "For whom?", options: ["The team", "Leadership"])
private let rewritten = RewriteResult(prompt: "Write a one-page summary of the Q3 report for the team.", techniques: ["Clear deliverable"])
private let draft = "write a summary of the q3 report"

@MainActor
final class CoachSessionTests: XCTestCase {
    private func make(_ engine: FakeEngine, draft: String = draft) -> CoachSession {
        CoachSession(engine: engine, config: { CoachConfig(provider: "ollama") }, draft: draft, host: "Claude, an AI chat app")
    }

    func testHappyPathAsksOneQuestionAtATimeThenRewrites() async {
        let e = FakeEngine()
        e.diagnoses = [.success(Diagnosis(reader: .person, questions: [q1, q2]))]
        e.rewrites = [.success(rewritten)]
        let s = make(e)
        s.start()
        XCTAssertEqual(s.step, .asking)
        await s.settled()
        XCTAssertEqual(s.step, .question(q1, index: 0, total: 2, chosen: nil))
        s.choose("One page")
        XCTAssertEqual(s.step, .question(q2, index: 1, total: 2, chosen: nil))
        s.choose(nil)   // skip
        XCTAssertEqual(s.step, .summary([.init(question: "How long?", answer: "One page"), .init(question: "For whom?", answer: nil)]))
        s.rewrite()
        await s.settled()
        XCTAssertEqual(s.step, .result(rewritten))
        // The model got the draft, the host, the answers (a skip is nil) and the reader call 1 decided.
        XCTAssertEqual(e.diagnoseCalls[0].draft, draft)
        XCTAssertEqual(e.diagnoseCalls[0].host, "Claude, an AI chat app")
        XCTAssertEqual(e.rewriteCalls[0].answers, [Answer(question: "How long?", answer: "One page"), Answer(question: "For whom?", answer: nil)])
        XCTAssertEqual(e.rewriteCalls[0].reader, .person)
    }

    func testAClearDraftSkipsStraightToTheRewrite() async {
        let e = FakeEngine()
        e.diagnoses = [.success(Diagnosis(reader: .ai, questions: []))]
        e.rewrites = [.success(rewritten)]
        let s = make(e)
        s.start(); await s.settled()
        XCTAssertEqual(s.step, .summary([]))
        s.rewrite(); await s.settled()
        XCTAssertEqual(s.textToPaste, rewritten.prompt)
    }

    func testYourOwnAnswerIsTrimmedAndABlankOneCountsAsSkipped() async {
        let e = FakeEngine()
        e.diagnoses = [.success(Diagnosis(reader: .ai, questions: [q1, q2]))]
        let s = make(e)
        s.start(); await s.settled()
        s.choose("  about 200 words \n")
        s.choose("   ")
        XCTAssertEqual(s.step, .summary([.init(question: "How long?", answer: "about 200 words"), .init(question: "For whom?", answer: nil)]))
    }

    func testBackAndChangeAnswersKeepWhatWasChosen() async {
        let e = FakeEngine()
        e.diagnoses = [.success(Diagnosis(reader: .ai, questions: [q1, q2]))]
        let s = make(e)
        s.start(); await s.settled()
        s.choose("One page"); s.back()
        XCTAssertEqual(s.step, .question(q1, index: 0, total: 2, chosen: "One page"))
        s.choose("Three bullets"); s.choose("The team")
        s.changeAnswers()
        XCTAssertEqual(s.step, .question(q1, index: 0, total: 2, chosen: "Three bullets"))
    }

    func testTheRewriteStreamsIntoTheCardBeforeItLands() async {
        let e = FakeEngine()
        e.diagnoses = [.success(Diagnosis(reader: .ai, questions: []))]
        e.rewrites = [.success(rewritten)]
        e.partials = ["Write a one"]
        var seen: [CoachSession.Step] = []
        let s = make(e)
        s.onChange = { seen.append(s.step) }
        s.start(); await s.settled()
        s.rewrite(); await s.settled()
        await Task.yield(); await Task.yield()
        XCTAssertTrue(seen.contains(.rewriting(partial: "")))
        // A late partial must never overwrite the finished rewrite.
        XCTAssertEqual(s.step, .result(rewritten))
    }

    // MARK: Error states

    func testNoKeyShowsAnErrorThatPointsAtSettings() async {
        let e = FakeEngine()
        e.diagnoses = [.failure(CoachFailure(code: "no-key", message: "No API key yet."))]
        let s = make(e)
        s.start(); await s.settled()
        guard case let .error(f) = s.step else { return XCTFail("expected an error, got \(s.step)") }
        XCTAssertEqual(f.message, "No API key yet.")
        XCTAssertTrue(f.needsSettings)
        XCTAssertNil(s.textToPaste)
    }

    func testTimeoutShowsAnErrorAndTryAgainAsksAgain() async {
        let e = FakeEngine()
        e.diagnoses = [.failure(CoachFailure(code: "timeout", message: "The model took longer than 90 seconds.")),
                       .success(Diagnosis(reader: .ai, questions: [q1]))]
        let s = make(e)
        s.start(); await s.settled()
        guard case let .error(f) = s.step else { return XCTFail("expected an error") }
        XCTAssertFalse(f.needsSettings)   // "Try again", not "Open settings"
        s.retry(); await s.settled()
        XCTAssertEqual(s.step, .question(q1, index: 0, total: 1, chosen: nil))
        XCTAssertEqual(e.diagnoseCalls.count, 2)
    }

    func testAModelErrorOnTheRewriteKeepsYourAnswersOnRetry() async {
        let e = FakeEngine()
        e.diagnoses = [.success(Diagnosis(reader: .ai, questions: [q1]))]
        e.rewrites = [.failure(CoachFailure(code: "unparseable", message: "The response came back malformed.")), .success(rewritten)]
        let s = make(e)
        s.start(); await s.settled()
        s.choose("One page"); s.rewrite(); await s.settled()
        guard case .error = s.step else { return XCTFail("expected an error") }
        s.retry(); await s.settled()
        XCTAssertEqual(s.step, .result(rewritten))
        XCTAssertEqual(e.diagnoseCalls.count, 1, "retrying a failed rewrite must not pay for the questions again")
        XCTAssertEqual(e.rewriteCalls.map(\.answers), [[Answer(question: "How long?", answer: "One page")], [Answer(question: "How long?", answer: "One page")]])
    }

    func testClosingTheCardCancelsTheCallAndIgnoresAnAnswerThatArrivesLate() async {
        let e = FakeEngine()
        e.diagnoses = [.success(Diagnosis(reader: .ai, questions: [q1]))]
        var release: CheckedContinuation<Void, Never>?
        e.gate = { await withCheckedContinuation { release = $0 } }
        let s = make(e)
        s.start()
        while release == nil { await Task.yield() }
        s.cancel()
        XCTAssertEqual(e.cancels, 1)
        release?.resume()
        await s.settled()
        XCTAssertEqual(s.step, .asking, "a cancelled call must not change the card")
    }

    func testACancelledCallShowsNoError() async {
        let e = FakeEngine()
        e.diagnoses = [.failure(CoachFailure(code: "cancelled", message: "Cancelled."))]
        let s = make(e)
        s.start(); await s.settled()
        XCTAssertEqual(s.step, .asking)
    }

    // MARK: The paste-back text

    func testOnlyTheFinishedRewriteIsPasted() async {
        let e = FakeEngine()
        e.diagnoses = [.success(Diagnosis(reader: .ai, questions: [q1]))]
        e.rewrites = [.success(rewritten)]
        let s = make(e)
        XCTAssertNil(s.textToPaste)
        s.start(); await s.settled()
        XCTAssertNil(s.textToPaste, "questions on screen: nothing to paste")
        s.choose("One page")
        XCTAssertNil(s.textToPaste)
        s.rewrite(); await s.settled()
        XCTAssertEqual(s.textToPaste, "Write a one-page summary of the Q3 report for the team.")   // not the draft, not uppercased
        s.leaveResult()
        XCTAssertNil(s.textToPaste, "back on the summary: nothing to paste")
    }

    func testTheRewriteIsPastedBackExactlyAndTheClipboardComesBack() async throws {
        let rewrite = RewriteResult(prompt: "Summarise Q3 for the team:\n\n- one page\n- plain words\n\n```swift\nlet x = 1\n```\nVoilà 🚀 日本語")
        let e = FakeEngine()
        e.diagnoses = [.success(Diagnosis(reader: .ai, questions: []))]
        e.rewrites = [.success(rewrite)]
        let s = make(e)
        s.start(); await s.settled(); s.rewrite(); await s.settled()
        let text = try XCTUnwrap(s.textToPaste)

        let pb = privateBoard()
        pb.setString("the user's own clipboard", forType: .string)
        let ax = FakeAX(); ax.field = "old draft"
        let keys = FakeKeys(pb)
        keys.pasteInto = { ax.field = $0 }
        let outcome = WriteBack(ax: ax, keys: keys, secure: FakeSecure(isSecureInputOn: false), pasteboard: pb, settle: 0.5, restoreDelay: 0.01).write(text)
        XCTAssertEqual(outcome, .pasted)
        XCTAssertEqual(ax.field, rewrite.prompt, "what lands in the box is the rewrite, byte for byte")
        XCTAssertEqual(pb.string(forType: .string), "the user's own clipboard")
    }
}

// MARK: Settings, Keychain, host labels

final class SettingsTests: XCTestCase {
    private func make() -> (CoachSettings, UserDefaults, InMemorySecretStore) {
        let suite = "poc.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let secrets = InMemorySecretStore()
        return (CoachSettings(defaults: defaults, secrets: secrets), defaults, secrets)
    }

    func testDefaultsToOllamaWithNoKeyAndAnAutomaticModel() {
        let (settings, _, _) = make()
        let c = settings.current()
        XCTAssertEqual(c, CoachConfig(provider: "ollama", model: "", apiKey: "", baseUrl: "", timeoutSeconds: 90))
        XCTAssertFalse(CoachSettings.providers.first { $0.id == "ollama" }!.needsKey)
    }

    func testProviderAndModelAreSettingsKeysAreSecrets() throws {
        let (settings, defaults, secrets) = make()
        settings.provider = "anthropic"
        settings.setModel("claude-sonnet-5-5", for: "anthropic")
        try settings.setKey("sk-ant-secret", for: "anthropic")
        let c = settings.current()
        XCTAssertEqual([c.provider, c.model, c.apiKey], ["anthropic", "claude-sonnet-5-5", "sk-ant-secret"])
        // The key is in the secret store and nowhere in UserDefaults.
        XCTAssertEqual(secrets.secret(for: "anthropic"), "sk-ant-secret")
        let stored = defaults.dictionaryRepresentation().map { "\($0.key)=\($0.value)" }.joined()
        XCTAssertFalse(stored.contains("sk-ant-secret"))
        // One key per provider, and the description never prints it.
        XCTAssertEqual(settings.key(for: "openai"), "")
        XCTAssertFalse(c.description.contains("sk-ant-secret"))
        XCTAssertTrue(c.description.contains("key: set"))
    }

    func testEmptyingTheKeyRemovesIt() throws {
        let (settings, _, secrets) = make()
        try settings.setKey("abc", for: "openai")
        try settings.setKey("", for: "openai")
        XCTAssertNil(secrets.secret(for: "openai"))
    }

    func testTheServerAddressOnlyAppliesToTheOtherProvider() {
        let (settings, _, _) = make()
        settings.baseUrl = "http://localhost:1234/v1"
        XCTAssertEqual(settings.current().baseUrl, "")
        settings.provider = "custom"
        XCTAssertEqual(settings.current().baseUrl, "http://localhost:1234/v1")
    }

    /// The real Keychain, on a throwaway service name. Off by default so the normal run can never raise
    /// a macOS password dialog; run with POC_TEST_KEYCHAIN=1 to check it.
    func testRealKeychainRoundTrip() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["POC_TEST_KEYCHAIN"] == "1", "opt-in: set POC_TEST_KEYCHAIN=1")
        let store = KeychainStore(service: "com.brycekallio.poc.test.\(UUID().uuidString)")
        XCTAssertNil(store.secret(for: "openai"))
        try store.setSecret("one", for: "openai")
        XCTAssertEqual(store.secret(for: "openai"), "one")
        try store.setSecret("two", for: "openai")
        XCTAssertEqual(store.secret(for: "openai"), "two")
        try store.setSecret("", for: "openai")
        XCTAssertNil(store.secret(for: "openai"))
    }
}

final class HostLabelTests: XCTestCase {
    func testAIAppsAreNamedAsSuchSoTheModelTreatsTheDraftAsAPrompt() {
        XCTAssertEqual(HostLabel.label(forApp: "Claude"), "Claude, an AI chat app")
        XCTAssertEqual(HostLabel.label(forApp: "T3 Code (Beta)"), "T3 Code (Beta), an AI chat app")
        XCTAssertEqual(HostLabel.label(forApp: "ChatGPT"), "ChatGPT, an AI chat app")
        XCTAssertEqual(HostLabel.label(forApp: "Notes"), "Notes")
    }
}

final class SettingsFormTests: XCTestCase {
    private func settings() -> CoachSettings {
        CoachSettings(defaults: UserDefaults(suiteName: "poc.form.\(UUID().uuidString)")!, secrets: InMemorySecretStore())
    }
    func testOllamaNeedsNothing() { XCTAssertTrue(SettingsForm(provider: "ollama").isValid) }
    func testHostedNeedsKeyUnlessSaved() {
        XCTAssertEqual(SettingsForm(provider: "anthropic").problems, [.needsKey])
        XCTAssertEqual(SettingsForm(provider: "anthropic", typedKey: "   ").problems, [.needsKey])
        XCTAssertTrue(SettingsForm(provider: "anthropic", typedKey: "sk-x").isValid)
        XCTAssertTrue(SettingsForm(provider: "anthropic", hasSavedKey: true).isValid)
    }
    func testCustomNeedsHttpAddress() {
        XCTAssertEqual(SettingsForm(provider: "custom").problems, [.needsAddress])
        XCTAssertEqual(SettingsForm(provider: "custom", baseUrl: "localhost:1234").problems, [.badAddress])
        XCTAssertEqual(SettingsForm(provider: "custom", baseUrl: "ftp://x").problems, [.badAddress])
        XCTAssertTrue(SettingsForm(provider: "custom", baseUrl: " http://localhost:1234/v1 ").isValid)
    }
    func testConfigUsesTypedKeyElseSaved() {
        XCTAssertEqual(SettingsForm(provider: "openai", typedKey: " new ").config(savedKey: "old").apiKey, "new")
        XCTAssertEqual(SettingsForm(provider: "openai").config(savedKey: "old").apiKey, "old")
        XCTAssertEqual(SettingsForm(provider: "ollama", typedKey: "stray").config(savedKey: "old").apiKey, "")
        XCTAssertEqual(SettingsForm(provider: "ollama", baseUrl: "http://x").config(savedKey: "").baseUrl, "")
    }
    func testSaveRoundTripAndBlankKeyKeepsSaved() throws {
        let s = settings()
        try SettingsForm(provider: "openai", model: " gpt-x ", typedKey: "k1").save(to: s)
        XCTAssertEqual(s.provider, "openai"); XCTAssertEqual(s.model(for: "openai"), "gpt-x"); XCTAssertEqual(s.key(for: "openai"), "k1")
        let again = SettingsForm.load(from: s)
        XCTAssertTrue(again.hasSavedKey); XCTAssertEqual(again.typedKey, "")
        try again.save(to: s)
        XCTAssertEqual(s.key(for: "openai"), "k1")
    }
    func testInvalidFormSavesNothing() throws {
        let s = settings()
        try SettingsForm(provider: "anthropic").save(to: s)
        XCTAssertEqual(s.provider, CoachSettings.defaultProvider)
    }
    func testTestSummaryNeverEchoesKey() {
        XCTAssertEqual(SettingsForm.testSummary(.failure(CoachFailure(code: "bad-key", message: "That key was rejected."))), "That key was rejected.")
        XCTAssertTrue(SettingsForm.testSummary(.success(1)).hasPrefix("Connected"))
    }
    func testHomeWindowRules() {
        XCTAssertTrue(HomeStatus.shouldShowWindow(selfTest: nil))
        XCTAssertFalse(HomeStatus.shouldShowWindow(selfTest: "cards"))
        XCTAssertTrue(HomeStatus.accessibilityLine(granted: true).contains("on"))
    }
}
