// A single-file, clickable demo of the real interface (src/panel.js, panel.css,
// caret.js) over a stand-in for claude.ai's composer. Fonts are inlined, so the
// built preview/demo.html opens straight from disk. No API calls: the questions
// are fixtures and the wait is faked.
//
//   npm run demo  →  open preview/demo.html          (type, hover the dot)
//   preview/demo.html?state=idle|loading|question|summary|result|error|nothing  (pinned, for screenshots)
import regular from "../node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2";
import medium from "../node_modules/geist/dist/fonts/geist-sans/Geist-Medium.woff2";
import { caretRect, groundOf } from "../src/caret.js";
import { loadFonts } from "../src/fonts.js";
import { createCoach } from "../src/panel.js";
import { writeBack } from "../src/writeback.js";

// What call 2 returns for this draft, as fixed sample output.
const rewritten = {
  prompt:
    "Summarize our Q3 report for leadership in one page of prose, with the details in a short appendix. Focus on results and risks, since they will skim it before Monday's review, and use the figures from the finance section. A good summary lets them decide whether to fund the second phase.",
  techniques: ["Clear deliverable", "Purpose & audience", "Format & length", "Explicit scope", "Success criteria", "Reasons given"],
};

const draft =
  "write a summary of the q3 report for the team, make it good and not too long but cover everything. use the numbers from the finance section";

const questions = [
  { id: "audience", quote: "for the team", question: "Is this for the people who did the work, or for leadership?",
    options: ["The team: what we did and learned", "Leadership: results and risks only", "Both, in separate sections"] },
  { id: "length", quote: "not too long but cover everything", question: "When length and coverage collide, which one wins?",
    options: ["Short: one page at most", "Complete: length is fine", "Short body, details in an appendix"] },
  { id: "numbers", quote: "", question: "Compare Q3's numbers with Q2, or report Q3 alone?",
    options: ["Compare with Q2", "Q3 alone", "Compare with Q3 last year"] },
];

const box = document.querySelector("#composer");
box.textContent = draft;
const fonts = { "fonts/Geist-Regular.woff2": regular, "fonts/Geist-Medium.woff2": medium };

let session = null;
const coach = createCoach({
  onHover: () => {
    if (session) show();
    else coach.idle({ words: draft.split(/\s+/).length });
    coach.open();
  },
  onAsk: ask,
  onRewrite: () => {
    coach.rewriting();
    setTimeout(() => (session.rewrite = rewritten, coach.isOpen() && showResult()), 1100);
  },
  onUse: (prompt) => {
    if (writeBack(box, prompt)) {
      session = null;
      coach.close();
    }
  },
  onClose: update,
  onOpenOptions: () => {},
  shadowMode: "open",
});
document.documentElement.append(coach.host);

function ask() {
  session = { status: "loading" };
  coach.pin();
  coach.loading();
  setTimeout(() => {
    session = { status: "done", state: { index: 0, answers: {} } };
    if (coach.isOpen()) show();
  }, 1200);
}
function showResult() {
  coach.result(session.rewrite, { onBack: () => (session.rewrite = null, show()) });
}
function show() {
  if (session.rewrite) return showResult();
  if (session.status === "loading") coach.loading();
  else coach.questions(questions, session.state);
}

function update() {
  coach.setTheme(groundOf(box));
  const active = document.activeElement === box;
  coach.setCaret(active && box.textContent.trim() ? caretRect(box, coach.layer) : null, box.getBoundingClientRect());
}
for (const t of ["selectionchange", "input", "focusin", "focusout", "keyup"]) document.addEventListener(t, () => requestAnimationFrame(update), true);
document.addEventListener("pointerdown", (e) => coach.isOpen() && !coach.contains(e) && coach.close(), true);
addEventListener("keydown", (e) => e.key === "Escape" && coach.close(), true);

await loadFonts((p) => fonts[p]);

// Put the caret at the end of the draft, as if you had just typed it.
box.focus();
const range = document.createRange();
range.selectNodeContents(box);
range.collapse(false);
getSelection().removeAllRanges();
getSelection().addRange(range);
update();

// Fixed states for screenshots.
const state = new URLSearchParams(location.search).get("state");
const states = {
  idle: () => coach.idle({ words: draft.split(/\s+/).length }),
  loading: () => coach.loading(),
  question: () => coach.questions(questions, { index: 1, answers: { audience: questions[0].options[1] } }),
  summary: () => coach.questions(questions, { index: 3, answers: { audience: questions[0].options[1], length: questions[1].options[2], numbers: null } }),
  error: () => coach.error({ code: "bad-key", message: "That API key was rejected." }),
  nothing: () => coach.nothing(),
  result: () => coach.result(rewritten, { onBack: () => {} }),
};
if (states[state]) {
  states[state]();
  coach.open({ pin: true });
}
