// Writes compositions/film.html from the extension's real panel CSS and markup.
// Text positions are measured here, in a browser with the real Geist files, so
// the film's timeline can move words without measuring anything at render time.
//   node tools/gen.mjs
// NOTE (2026-11-12): compositions/film.html has since been edited directly (Studio ids, end-card copy and
// times, titles moved to compositions/captions.html for the voiceover). Running this overwrites those edits.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire("/tmp/poc-smoke/");
const puppeteer = require("puppeteer");
const VIDEO = path.resolve(import.meta.dirname, "..");
const EXT = path.resolve(VIDEO, "../extension");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The film's facts. REWRITE is a real result: P.O.C's rewrite() on qwen2.5 with
// these answers, passing every check (unverified: []).
const DRAFT = "write a summary of the q3 report for the team, make it good and not too long but cover everything. use the numbers from the finance section";
const REWRITE = "Create a concise summary of the Q3 report for leadership, focusing on results and risks, and include the financial numbers from the finance section. Keep the main body brief, with detailed comparisons and data in an appendix.";
const TECHNIQUES = ["Clear deliverable", "Purpose & audience", "Explicit scope", "Reasons given"];
const QS = [
  { id: "q1", step: "1 of 3", quote: "for the team", question: "Is this for the people who did the work, or for leadership?", options: ["The team: what we did and learned", "Leadership: results and risks only", "Both, in separate sections"], pick: 1 },
  { id: "q2", step: "2 of 3", quote: "not too long but cover everything", question: "When length and coverage collide, which one wins?", options: ["Short: one page at most", "Complete: length is fine", "Short body, details in an appendix"], pick: 2 },
  { id: "q3", step: "3 of 3", quote: "", question: "Compare Q3's numbers with Q2, or report Q3 alone?", options: ["Compare with Q2", "Q3 alone", "Compare with Q3 last year"], pick: 1 },
];

// Stage geometry, in px at 1920x1080.
const FULL = { x: 96, y: 110, w: 1728, h: 680, pad: 92, font: 68, line: 88 };
const SHRINK = { scale: 0.529, x: 96, y: 262 };
const PANEL = { x: 1056, scale: 2.4 };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const wm = `<span class="wm" role="img" aria-label="P.O.C">p<span class="wm-o" aria-hidden="true"></span>c</span>`;
const X = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>`;
const CHECK = `<svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
const bar = (step = "") => `<div class="bar"><span class="name">${wm}</span><span class="step num">${step}</span><button class="icon" type="button">${X}</button></div>`;

const panelCss = fs.readFileSync(path.join(EXT, "src/panel.css"), "utf8")
  .replace(/:host\(\[data-theme="dark"\]\) \{[\s\S]*?\n\}\n/, "")
  .replace(":host {", "#stage {").replace("all: initial;", "")
  .replace('"POC Geist", ', "")
  .replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n/g, "")
  .replace(/\n\s*transition:[^;]+;/g, "").replace(/\n\s*animation:[^;]+;/g, "");
const overrides = `
.popup { position: absolute; left: 0; top: 0; overflow: visible; transform-origin: 0 0; }
.dot { position: static; margin: 0; }
.wm-o { flex: none; }`;

const qHtml = (q, picked) => `<div class="popup">${bar(q.step)}<div class="body"><div class="q">${q.quote ? `<p class="quote">“${esc(q.quote)}”</p>` : ""}<p class="question">${esc(q.question)}</p><div class="opts">${q.options.map((o, i) => `<button class="opt${i === q.pick ? " pick" : ""}" type="button" aria-pressed="${picked && i === q.pick}"><span>${esc(o)}</span>${CHECK}</button>`).join("")}</div><div class="alt"><button class="link" type="button">Write my own</button><button class="link" type="button">Skip</button><button class="link back" type="button">Back</button></div></div></div></div>`;

const STATES = {
  idle: `<div class="popup">${bar()}<div class="body"><div class="idle"><p class="lead">Sharpen this with a few quick questions.</p><div class="row"><span class="meta num">${DRAFT.split(/\s+/).length} words</span><button class="btn primary go" type="button">Coach this draft</button></div></div></div></div>`,
  load1: `<div class="popup">${bar()}<div class="body"><span class="sk sk-quote"></span><span class="sk sk-question"></span><span class="sk sk-question short"></span><div class="opts"><span class="sk sk-opt"></span><span class="sk sk-opt"></span><span class="sk sk-opt"></span></div></div></div>`,
  q1: qHtml(QS[0]), q1p: qHtml(QS[0], true),
  q2: qHtml(QS[1]), q2p: qHtml(QS[1], true),
  q3: qHtml(QS[2]), q3p: qHtml(QS[2], true),
  summary: `<div class="popup">${bar()}<div class="body"><p class="lead">Got it. Here is what the rewrite will use.</p><ul class="answers">${QS.map((q) => `<li><span class="sq">${esc(q.question)}</span><span class="sa">${esc(q.options[q.pick])}</span></li>`).join("")}</ul><div class="foot"><button class="link" type="button">Change answers</button><button class="btn primary go" type="button">Rewrite</button></div></div></div>`,
  load2: `<div class="popup">${bar()}<div class="body"><span class="sk sk-line"></span><span class="sk sk-line"></span><span class="sk sk-line"></span><span class="sk sk-line"></span><span class="sk sk-line"></span><span class="sk sk-line"></span></div></div>`,
  result: `<div class="popup">${bar()}<div class="body"><div class="rewrite">${esc(REWRITE)}</div><ul class="techniques">${TECHNIQUES.map((t) => `<li>${esc(t)}</li>`).join("")}</ul><div class="foot"><button class="link" type="button">Back</button><div class="actions"><button class="btn ghost" type="button">Copy</button><button class="btn primary go" type="button">Use this</button></div></div></div></div>`,
};

// Longest common subsequence of exact words: those travel, the rest are replaced.
function lcs(a, b) {
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (t[i + 1][j] >= t[i][j + 1]) i++; else j++;
  }
  return pairs;
}

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
const fontUrl = (f) => `file://${VIDEO}/assets/fonts/${f}`;
const faces = (url) => [["Regular", 400], ["Medium", 500], ["SemiBold", 600]].map(([n, w]) => `@font-face{font-family:"Geist";font-weight:${w};src:url("${url(`Geist-${n}.woff2`)}") format("woff2");}`).join("");
const oldWords = DRAFT.split(" "), newWords = REWRITE.split(" ");
const para = (id, words) => `<div id="${id}" style="position:absolute;left:0;top:0;width:${FULL.w - FULL.pad * 2}px;font:400 ${FULL.font}px/${FULL.line}px Geist;letter-spacing:-0.01em">${words.map((w) => `<span>${esc(w)}</span>`).join(" ")}</div>`;
const tmp = path.join(VIDEO, "tools/.measure.html");
fs.writeFileSync(tmp, `<!doctype html><style>${faces(fontUrl)}${panelCss}${overrides}#stage{position:absolute;inset:0}.state{position:absolute;left:${PANEL.x}px;top:0;transform:scale(${PANEL.scale});transform-origin:0 0}</style><div id="stage">${para("old", oldWords)}${para("new", newWords)}${Object.entries(STATES).map(([k, v]) => `<div class="state" data-k="${k}">${v}</div>`).join("")}</div>`);
await page.goto(`file://${tmp}`);
await page.evaluate(() => document.fonts.ready);
await sleep(400);
const m = await page.evaluate(() => {
  const words = (id) => [...document.querySelectorAll(`#${id} span`)].map((s) => ({ x: s.offsetLeft, y: s.offsetTop, w: s.offsetWidth }));
  const states = {};
  for (const el of document.querySelectorAll(".state")) {
    const h = el.firstChild.offsetHeight;
    const target = (sel) => { const t = el.querySelector(sel); if (!t) return null; let x = 0, y = 0, n = t; while (n && n !== el) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return { x: x + t.offsetWidth / 2, y: y + t.offsetHeight / 2 }; };
    const q = el.querySelector(".quote");
    let quote = null;
    if (q) { let y = 0, x = 0, n = q; while (n && n !== el) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } quote = { x: x + 8, y }; }
    states[el.dataset.k] = { h, pick: target(".pick"), go: target(".go"), quote };
  }
  return { old: words("old"), neu: words("new"), states };
});
await browser.close();
fs.rmSync(tmp);

const top = (k) => Math.round((1080 - m.states[k].h * PANEL.scale) / 2);
const stageOf = (k, p) => ({ x: Math.round(PANEL.x + p.x * PANEL.scale), y: Math.round(top(k) + p.y * PANEL.scale) });

const keptPairs = lcs(oldWords, newWords);
const keptOld = new Map(keptPairs), keptNew = new Set(keptPairs.map(([, j]) => j));
const phrase = (s) => { const w = s.split(" "); for (let i = 0; i < oldWords.length; i++) if (w.every((x, k) => oldWords[i + k]?.replace(/[,.]$/, "") === x)) return w.map((_, k) => i + k); return []; };
const FOCUS = { q1: phrase("for the team"), q2: phrase("not too long but cover everything") };

const wordSpan = (id, cls, p, t) => `<span id="${id}" class="w ${cls}" style="left:${p.x}px;top:${p.y}px">${esc(t)}</span>`;
const words = [
  ...oldWords.map((t, i) => wordSpan(`o${i}`, `old${keptOld.has(i) ? " kept" : " gone"}`, m.old[i], t)),
  ...newWords.map((t, j) => (keptNew.has(j) ? "" : wordSpan(`n${j}`, "fresh", m.neu[j], t))),
].join("");

const lastOld = m.old.at(-1), lastNew = m.neu.at(-1);
const dotAt = { x: lastOld.x + lastOld.w + 22, y: lastOld.y + 11 };
const dotNew = { x: lastNew.x + lastNew.w + 22, y: lastNew.y + 11 };

// Panel states on the film's clock.
const CLOCK = [["idle", 4.75, 5.8], ["load1", 5.8, 6.4], ["q1", 6.4, 9], ["q1p", 9, 9.35], ["q2", 9.35, 12.6], ["q2p", 12.6, 12.95], ["q3", 12.95, 14.8], ["q3p", 14.8, 15.1], ["summary", 15.1, 16.25], ["load2", 16.25, 16.8], ["result", 16.8, 18.6]];
const panels = CLOCK.map(([k, a, b]) => `<div id="st-${k}" class="state clip" data-start="${a}" data-duration="${(b - a).toFixed(2)}" data-track-index="2" style="top:${top(k)}px">${STATES[k]}</div>`).join("\n    ");

const CAPS = [
  ["cap1", 0.8, 1.85, "low", "You can’t have both."],
  ["cap2", 3.1, 1.3, "low", "P.O.C sits by your cursor."],
  ["cap3", 6.6, 2.6, "high", "It asks about your words."],
  ["cap4", 9.9, 2.9, "high", "You choose what you meant."],
  ["cap5", 17, 1.5, "high", "Then it rewrites."],
  ["cap6", 20.5, 4.1, "low", "Same request. Now it’s clear."],
];
const caps = CAPS.map(([id, s, d, slot, t]) => `<p id="${id}" class="cap ${slot} clip"${id === "cap6" ? " data-hold" : ""} data-start="${s}" data-duration="${d}" data-track-index="3">${t.split(" ").map((w) => `<span>${w}</span>`).join(" ")}</p>`).join("\n    ");

// The words carried from the draft into the panel's quote, in stage px.
const shrunk = (p) => ({ x: SHRINK.x + (FULL.pad + p.x) * SHRINK.scale, y: SHRINK.y + (FULL.pad - 20 + p.y) * SHRINK.scale });
const carry = (qid, s) => FOCUS[qid].map((i, n) => {
  const from = shrunk(m.old[i]); const q = stageOf(qid, m.states[qid].quote);
  return { id: `c-${qid}-${n}`, text: oldWords[i].replace(/[,.]$/, ""), from, to: { x: q.x + FOCUS[qid].slice(0, n).reduce((a, k) => a + m.old[k].w * (28.8 / 68) + 8, 12), y: q.y }, s };
});
const carried = [...carry("q1", 6.4), ...carry("q2", 9.35)];
const carrySpans = carried.map((c) => `<span id="${c.id}" class="carry clip" data-start="${c.s}" data-duration="0.56" data-track-index="4" style="left:${c.to.x.toFixed(1)}px;top:${c.to.y}px">${esc(c.text)}</span>`).join("");

const REST = { x: 980, y: 900 };
const CURSOR = [
  [3.7, { x: 1500, y: 1120 }],
  [4.3, shrunkLess()],
  [5.35, stageOf("idle", m.states.idle.go)],
  [5.95, REST],
  [8.6, stageOf("q1", m.states.q1.pick)],
  [9.35, REST],
  [12.2, stageOf("q2", m.states.q2.pick)],
  [12.75, REST],
  [14.45, stageOf("q3", m.states.q3.pick)],
  [15.85, stageOf("summary", m.states.summary.go)],
  [18.1, stageOf("result", m.states.result.go)],
];
function shrunkLess() { return { x: FULL.x + FULL.pad + dotAt.x + 60, y: FULL.y + FULL.pad - 20 + dotAt.y + 34 }; }

const data = { oldWords: m.old, newWords: m.neu, pairs: keptPairs, FOCUS, FULL, SHRINK, dotAt, dotNew, carried, CURSOR, CAPS };
const html = `<template>
  <style>
    ${faces((f) => `assets/fonts/${f}`)}
    ${panelCss}
    ${overrides}
    #root { position: absolute; inset: 0; background: #fff; overflow: hidden; font-family: Geist, sans-serif; color: #0a0a0a; }
    #stage { position: absolute; inset: 0; }
    #composer { position: absolute; left: ${FULL.x}px; top: ${FULL.y}px; width: ${FULL.w}px; height: ${FULL.h}px; box-sizing: border-box; border: 4px solid #1d5fbf; border-radius: 44px; background: #fff; transform-origin: 0 0; }
    #text { position: absolute; left: ${FULL.pad - 4}px; top: ${FULL.pad - 24}px; right: 0; bottom: 0; }
    .w { position: absolute; font: 400 ${FULL.font}px/${FULL.line}px Geist, sans-serif; letter-spacing: -0.01em; white-space: nowrap; color: #0a0a0a; }
    .fresh { opacity: 0; }
    #caret { position: absolute; left: ${dotAt.x - 18}px; top: ${dotAt.y}px; width: 5px; height: 66px; background: #0a0a0a; }
    #dot { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    #dot .dot { zoom: 18; }
    #dot .orb { width: max-content; transform-origin: 0 0; }
    .state { position: absolute; left: ${PANEL.x}px; width: 320px; transform: scale(${PANEL.scale}); transform-origin: 0 0; }
    .cap { position: absolute; left: 96px; font: 600 56px/68px Geist, sans-serif; letter-spacing: -0.01em; color: #0a0a0a; }
    .cap.low { top: 862px; }
    .cap.high { top: 690px; }
    #st-q1 .quote, #st-q2 .quote { color: transparent; }
    #example { position: absolute; left: 96px; top: 948px; font: 400 30px/40px Geist, sans-serif; color: #6b6b6b; }
    .carry { position: absolute; font: 400 28.8px/38px Geist, sans-serif; color: #0a0a0a; white-space: nowrap; }
    #cursor { position: absolute; left: 0; top: 0; width: 42px; height: 56px; z-index: 20; }
    #end-line { position: absolute; left: 0; right: 0; top: 650px; text-align: center; font: 600 56px/68px Geist, sans-serif; letter-spacing: -0.01em; }
    #end-sub { position: absolute; left: 0; right: 0; top: 730px; text-align: center; font: 400 36px/46px Geist, sans-serif; color: #6b6b6b; }
    #end-cta { position: absolute; left: 50%; top: 820px; width: 720px; margin-left: -360px; height: 96px; border-radius: 18px; background: #141414; color: #fff; font: 500 40px/96px Geist, sans-serif; text-align: center; }
  </style>
  <div id="root" data-composition-id="film" data-width="1920" data-height="1080">
    <div id="stage" data-layout-allow-overlap>
    <div id="composer" class="clip" data-start="0" data-duration="29.6" data-track-index="1">
      <div id="text">${words}<i id="caret"></i>
        <div id="dot" data-layout-ignore><button class="dot" type="button" aria-expanded="false"><span class="orb">${wm}</span></button></div>
      </div>
    </div>
    ${panels}
    ${carrySpans}
    ${caps}
    <p id="example" class="clip" data-start="16.8" data-duration="7.9" data-track-index="3">Example, best of several runs</p>
    <p id="end-line" class="clip" data-start="26.1" data-duration="3.5" data-track-index="3">It asks first. Then it rewrites.</p>
    <p id="end-sub" class="clip" data-start="26.6" data-duration="3" data-track-index="3">Free with Ollama, or use your own key.</p>
    <div id="end-cta" class="clip" data-start="27.1" data-duration="2.5" data-track-index="3">github.com/brycekallio/poc</div>
    <svg id="cursor" class="clip" data-start="3.7" data-duration="15.2" data-track-index="5" viewBox="0 0 20 26"><path d="M2 2l14 11-6 1 3.500 7-3 1.500L7 15.500 2 20z" fill="#0a0a0a" stroke="#fff" stroke-width="1.5"/></svg>
    </div>
  </div>
  <script>
    const D = ${JSON.stringify(data)};
    const tl = gsap.timeline({ paused: true });
    const css = (sel, vars, at) => tl.to(sel, vars, at);
    const dim = "#949494", ink = "#0a0a0a";
    const others = (keep) => D.oldWords.map((_, i) => i).filter((i) => !keep.includes(i)).map((i) => "#o" + i);
    const focus = (keep, at) => {
      if (keep.length) tl.to(others(keep).join(","), { color: dim, duration: 0.3, ease: "power2.inOut" }, at);
      tl.to(keep.map((i) => "#o" + i).join(","), { color: ink, duration: 0.3, ease: "power2.inOut" }, at);
    };
    const orbScale = 3 / 18; // The dot is laid out at 18x so its disc stays round.

    gsap.set("#dot", { x: D.dotAt.x, y: D.dotAt.y, scale: orbScale, opacity: 0 });
    gsap.set(".carry", { transformOrigin: "0 0" });
    gsap.set("#cursor", { x: D.CURSOR[0][1].x, y: D.CURSOR[0][1].y });

    // Hook: the contradiction alone in ink.
    focus(D.FOCUS.q2, 0.5);
    tl.to(D.oldWords.map((_, i) => "#o" + i).join(","), { color: ink, duration: 0.3, ease: "power2.inOut" }, 2.7);

    // The dot arrives at the caret.
    tl.to("#caret", { opacity: 0, duration: 0.05 }, 3);
    tl.fromTo("#dot", { opacity: 0, scale: orbScale * 0.6 }, { opacity: 1, scale: orbScale, duration: 0.26, ease: "expo.out" }, 3);

    // Cursor path. Each move lands just before its click.
    D.CURSOR.slice(1).forEach(([t, p], i) => tl.to("#cursor", { x: p.x, y: p.y, duration: i === 0 ? 0.6 : 0.4, ease: "power2.inOut" }, t - (i === 0 ? 0.6 : 0.4) + 0.3));

    // Hover: the composer moves aside and the panel opens.
    tl.to("#composer", { x: D.SHRINK.x - D.FULL.x, y: D.SHRINK.y - D.FULL.y, scale: D.SHRINK.scale, duration: 0.6, ease: "power2.inOut" }, 4.4);

    // Each panel opens with the product's own pop.
    ["idle"].forEach(() => tl.fromTo("#st-idle .popup", { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.15, ease: "power4.out" }, 4.75));

    // Clicks press the button for three frames.
    for (const [sel, at] of [["#st-idle .go", 5.65], ["#st-summary .go", 16.15], ["#st-result .go", 18.45]]) {
      tl.to(sel, { scale: 0.98, duration: 0.05 }, at).to(sel, { scale: 1, duration: 0.05 }, at + 0.1);
    }
    tl.to("#st-result .popup", { opacity: 0, scale: 0.96, duration: 0.12, ease: "power3.in" }, 18.55);

    // Questions: the words they quote travel from the draft to the panel.
    focus(D.FOCUS.q1, 6.3);
    focus(D.FOCUS.q2, 9.25);
    for (const c of D.carried) {
      tl.fromTo("#" + c.id, { x: c.from.x - c.to.x, y: c.from.y - c.to.y, scale: 1.26, color: ink }, { x: 0, y: 0, scale: 1, color: "#6b6b6b", duration: 0.55, ease: "power2.inOut" }, c.s);
    }
    tl.set("#st-q1 .quote", { color: "#6b6b6b" }, 6.95);
    tl.set("#st-q2 .quote", { color: "#6b6b6b" }, 9.9);
    tl.to(D.oldWords.map((_, i) => "#o" + i).join(","), { color: ink, duration: 0.3, ease: "power2.inOut" }, 12.9);

    // Technique tags land one by one on the result.
    tl.fromTo("#st-result .techniques li", { opacity: 0 }, { opacity: 1, duration: 0.12, stagger: 0.08 }, 17.1);

    // Payoff: back to full frame. Kept words travel, the rest are replaced.
    tl.to("#composer", { x: 0, y: 0, scale: 1, duration: 0.7, ease: "power2.inOut" }, 18.6);
    const gone = D.oldWords.map((_, i) => i).filter((i) => !D.pairs.some(([a]) => a === i)).map((i) => "#o" + i);
    tl.to(gone.join(","), { opacity: 0, filter: "blur(8px)", duration: 0.2, stagger: 0.012, ease: "power3.in" }, 18.85);
    D.pairs.forEach(([a, b], k) => tl.to("#o" + a, { x: D.newWords[b].x - D.oldWords[a].x, y: D.newWords[b].y - D.oldWords[a].y, duration: 0.65, ease: "power2.inOut" }, 19.05 + k * 0.012));
    const fresh = D.newWords.map((_, j) => j).filter((j) => !D.pairs.some(([, b]) => b === j)).map((j) => "#n" + j);
    tl.fromTo(fresh.join(","), { opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.14, stagger: 0.04, ease: "power4.out" }, 19.55);
    tl.to("#dot", { x: D.dotNew.x, y: D.dotNew.y, duration: 0.65, ease: "power2.inOut" }, 19.05);

    // Captions land word by word from grey to ink, then hold still.
    for (const [id, s, d] of D.CAPS) {
      tl.fromTo("#" + id + " span", { color: "#949494" }, { color: ink, duration: 0.2, stagger: 0.08 }, s);
      tl.to("#" + id, { opacity: 0, filter: "blur(8px)", duration: 0.16, ease: "power3.in" }, s + d - 0.2);
    }

    // End card: the dot is carried to centre and becomes the mark.
    tl.to(".w", { opacity: 0, filter: "blur(8px)", duration: 0.2, ease: "power3.in" }, 24.7);
    tl.to("#composer", { borderColor: "rgba(29,95,191,0)", duration: 0.25 }, 24.75);
    tl.to("#dot", { x: 960 - D.FULL.x - ${FULL.pad - 4} - 4 - 321, y: 340 - D.FULL.y - ${FULL.pad - 24} - 4 - 120, scale: 1, duration: 0.8, ease: "power2.inOut" }, 24.85);
    tl.to("#dot .orb", { backgroundColor: "rgba(255,255,255,0)", boxShadow: "inset 0 0 0 0 rgba(0,0,0,0), inset 0 0 0 rgba(255,255,255,0), 0 0 0 rgba(0,0,0,0), 0 0 0 rgba(0,0,0,0)", duration: 0.4 }, 25.2);
    tl.fromTo("#end-line", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.18 }, 26.1);
    tl.fromTo("#end-sub", { opacity: 0 }, { opacity: 1, duration: 0.2 }, 26.6);
    tl.fromTo("#end-cta", { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.15, ease: "power4.out" }, 27.1);
    tl.to({}, { duration: 0.01 }, 29.58);

    window.__timelines["film"] = tl;
  </script>
</template>
`;
fs.mkdirSync(path.join(VIDEO, "compositions"), { recursive: true });
fs.writeFileSync(path.join(VIDEO, "compositions/film.html"), html);
console.log("kept words", keptPairs.length, "of", newWords.length);
console.log("panel heights", Object.fromEntries(Object.entries(m.states).map(([k, v]) => [k, Math.round(v.h * PANEL.scale)])));
console.log("q2 focus", FOCUS.q2, "lines", FOCUS.q2.map((i) => m.old[i].y));
