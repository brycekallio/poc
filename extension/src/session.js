// One coaching session per draft: ask → answer → rewrite → use.
//
// Pure state, no DOM and no Chrome. The two model calls come in as functions,
// so content.js passes ones that message the worker, and dev/demo.js and
// test/session.test.mjs pass fixtures. Both share every transition, so the demo
// cannot drift from the extension.
//
// view(draft) is the only thing the popup reads: what to show for the draft
// that is in the box right now. Re-hovering an unchanged draft resumes where you
// were instead of paying for the same questions twice.

/**
 * @typedef {{ code: string, message: string }} CoachFailure
 * @typedef {{ id: string, quote: string, question: string, options: string[] }} Question
 * @typedef {{ prompt: string, techniques: string[], unverified?: string[] }} Rewrite
 *
 * @param {{
 *   diagnose: (draft: string) => Promise<{ questions: Question[], reader?: "ai"|"person" }>,
 *   rewrite: (draft: string, answers: Array<{ question: string, answer: string|null }>, reader?: "ai"|"person") => Promise<Rewrite>,
 *   onChange?: () => void,   // called after every async step lands
 * }} calls Each call throws a CoachFailure (or anything) when it fails.
 */
export function createSession({ diagnose, rewrite, onChange = () => {} }) {
  // { draft, step: "asking"|"questions"|"rewriting"|"result"|"error",
  //   questions, index, answers, reader, result, error, failed: "ask"|"rewrite" }
  //   reader: who call 1 decided the draft is for, handed to call 2.
  let s = null;
  let run = 0; // bumps when a newer request supersedes an older one

  async function attempt(call, pending, landed, failed) {
    const thisRun = ++run;
    s = { ...s, step: pending, error: null };
    try {
      const out = await call();
      if (run === thisRun) s = { ...s, ...landed(out) };
    } catch (err) {
      if (run === thisRun) s = { ...s, step: "error", failed, error: asFailure(err) };
    }
    if (run === thisRun) onChange();
  }

  const self = {
    /** What the popup should show for the draft currently in the box. */
    view(draft) {
      draft = draft.trim();
      if (!draft) return { kind: "empty" };
      if (s?.draft !== draft) return { kind: "idle", words: draft.split(/\s+/).length };
      switch (s.step) {
        case "asking": return { kind: "loading" };
        case "rewriting": return { kind: "rewriting" };
        case "error": return { kind: "error", error: s.error };
        case "result": return { kind: "result", result: s.result };
      }
      const { questions, index, answers } = s;
      if (index < questions.length) {
        const q = questions[index];
        return { kind: "question", question: q, index, total: questions.length, answer: answers[q.id] };
      }
      // Also the clear-draft case (no questions): the rewrite still applies the
      // techniques, so there is always a way to it.
      return { kind: "summary", questions, answers };
    },

    ask(draft) {
      s = { draft: draft.trim() };
      return attempt(() => diagnose(s.draft), "asking",
        ({ questions, reader }) => ({ step: "questions", questions, reader, index: 0, answers: {} }), "ask");
    },

    /** Answer the current question (null skips it) and move to the next. */
    choose(value) {
      if (s?.step !== "questions") return;
      const q = s.questions[s.index];
      if (!q) return;
      s = { ...s, answers: { ...s.answers, [q.id]: value }, index: s.index + 1 };
    },
    back() {
      if (s?.step === "questions" && s.index > 0) s = { ...s, index: s.index - 1 };
    },
    changeAnswers() {
      if (s?.step === "questions") s = { ...s, index: 0 };
    },

    rewrite() {
      if (!s?.questions) return;
      const answers = s.questions.map((q) => ({ question: q.question, answer: s.answers[q.id] ?? null }));
      return attempt(() => rewrite(s.draft, answers, s.reader), "rewriting",
        (result) => ({ step: "result", result }), "rewrite");
    },

    /** "Try again": repeats whichever call failed. A failed rewrite keeps your answers. */
    retry() {
      if (s?.step !== "error") return;
      return s.failed === "rewrite" ? self.rewrite() : self.ask(s.draft);
    },

    /** From the result back to the answers summary. */
    leaveResult() {
      if (s?.step === "result") s = { ...s, step: "questions", result: null, index: s.questions.length };
    },

    /** The rewrite went into the box, so the draft changed and this session is spent. */
    used() {
      run++;
      s = null;
    },
  };
  return self;
}

function asFailure(err) {
  if (err && typeof err.code === "string" && typeof err.message === "string") return { code: err.code, message: err.message };
  return { code: "unknown", message: "Something went wrong." };
}
