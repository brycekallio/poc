// Writes compositions/captions.html from script.json.
//   node tools/captions.mjs                      timings from script.json (placeholder, no voice yet)
//   node tools/captions.mjs assets/transcript.json   timings from the real voiceover
// The transcript is what `npx hyperframes transcribe assets/voiceover.mp3 --model small.en --json`
// writes. Its words are matched to the script's words by position, not by text, so the script must
// match what was actually said word for word.
import fs from "node:fs";
import path from "node:path";

const VIDEO = path.resolve(import.meta.dirname, "..");
const { lines } = JSON.parse(fs.readFileSync(path.join(VIDEO, "script.json"), "utf8"));
const tPath = process.argv[2];
const spoken = tPath ? JSON.parse(fs.readFileSync(path.resolve(VIDEO, tPath), "utf8")) : null;
const said = spoken ? (Array.isArray(spoken) ? spoken : spoken.words).filter((w) => /[\p{L}\p{N}]/u.test(w.text)) : null;

// Every word of the script, with a time. Without a transcript, a line's time is spread over its
// groups and words by character count, which is roughly how speech spends it.
let n = 0;
const groups = [];
for (const line of lines) {
  const chars = (s) => s.replace(/\s/g, "").length;
  const total = line.groups.reduce((a, g) => a + chars(g), 0);
  const gap = 0.12;
  const span = line.end - line.start - gap * (line.groups.length - 1);
  let t = line.start;
  line.groups.forEach((text, gi) => {
    const len = (chars(text) / total) * span;
    const words = text.split(" ");
    let wt = t;
    const timed = words.map((w) => {
      const d = (chars(w) / chars(text)) * len;
      const est = { text: w, start: wt, end: wt + d };
      wt += d;
      const i = n++;
      if (!said) return est;
      if (!said[i]) throw new Error(`transcript ran out at "${w}" in ${line.id}; the script must match what was said`);
      return { text: w, start: said[i].start, end: said[i].end };
    });
    if (!line.onCard) groups.push({ id: `${line.id}g${gi + 1}`, slot: line.slot, words: timed });
    t += len + gap;
  });
}
if (said && n !== said.length) console.warn(`transcript has ${said.length} words, script has ${n}: check the words match`);

const r = (x) => Math.round(x * 100) / 100;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "’");
// A group shows from just before its first word to a beat after its last, and never overlaps the next.
groups.forEach((g, i) => {
  g.start = r(Math.max(0.1, g.words[0].start - 0.08));
  const next = groups[i + 1];
  g.end = r(Math.min(g.words.at(-1).end + 0.35, next ? next.words[0].start - 0.1 : 29.6));
});

const html = `<template>
  <style>
    @font-face { font-family: Geist; src: url("assets/fonts/Geist-SemiBold.woff2") format("woff2"); font-weight: 600; }
    #root { position: absolute; inset: 0; pointer-events: none; }
    .cg { position: absolute; left: 96px; margin: 0; font: 600 56px/68px Geist, sans-serif; letter-spacing: -0.01em; color: #949494; white-space: nowrap; }
    .cg.low { top: 862px; }
    .cg.high { top: 690px; }
  </style>
  <div id="root" data-composition-id="captions" data-width="1920" data-height="1080">
    ${groups.map((g) => `<p id="${g.id}" class="cg ${g.slot} clip" data-start="${g.start}" data-duration="${r(g.end - g.start)}" data-track-index="1">${g.words.map((w, k) => `<span id="${g.id}w${k}">${esc(w.text)}</span>`).join(" ")}</p>`).join("\n    ")}
  </div>
  <script>
    // Each word turns from grey to ink as it is said, the film's own title style.
    const G = ${JSON.stringify(groups.map((g) => ({ id: g.id, end: g.end, words: g.words.map((w) => r(w.start)) })))};
    const tl = gsap.timeline({ paused: true });
    for (const g of G) {
      g.words.forEach((t, k) => tl.fromTo("#" + g.id + "w" + k, { color: "#949494" }, { color: "#0a0a0a", duration: 0.12, ease: "power2.out" }, t));
      tl.fromTo("#" + g.id + " span", { opacity: 1 }, { opacity: 0, duration: 0.14, ease: "power3.in" }, g.end - 0.16);
    }
    tl.to({}, { duration: 0.01 }, 29.58);
    window.__timelines["captions"] = tl;
  </script>
</template>
`;
fs.writeFileSync(path.join(VIDEO, "compositions/captions.html"), html);
console.log(`${groups.length} caption groups, ${n} spoken words`);
