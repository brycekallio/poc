# REVIEW: P.O.C demo film

## 2026-11-12: voiceover draft

**Delivered:** `site/media/demo.mp4` (served at https://poc-prompt-coach.netlify.app/media/demo.mp4 after the next
deploy), 29.6 s, 1920x1080, 30 fps, 2.2 MB, with a silent voiceover slot. README GIF `docs/demo.gif`, 800 px,
15 fps, 1.8 MB, links to that MP4. `docs/demo.mp4` was removed so the video lives in one place.

- The six on-screen titles became a caption track (`compositions/captions.html`, generated from `script.json`
  by `tools/captions.mjs`). They follow the voiceover script in `SCRIPT.md`, word by word from grey to ink, in the
  same slots and type the titles used.
- End card lines come in earlier (25.5 / 26.3 / 27.0 s, were 26.1 / 26.6 / 27.1) so the last two spoken lines
  land on them.
- `check`: 0 errors. New warnings: `audio_clip_silent` on the placeholder voiceover (expected). The rest are
  the older ones listed below.
- Looked at: snapshot frames at every caption group and five frames pulled from the rendered MP4.
- Not done: no voice yet (Bryce's ElevenLabs clone), so nobody has heard the timing.

## 2026-11-01: original film

**Delivered:** `renders/poc-demo.mp4`, 29.6 s, 1920x1080, 30 fps, 2.7 MB. Copied to `code/docs/demo.mp4`.
The README shows it as `docs/demo.gif` (960 px, 12 fps, 1.3 MB) because GitHub downloads MP4 links instead of playing them. Regenerate with `node tools/gen.mjs`, then render. `tools/gen.mjs` holds the final clock; edit it, not
`compositions/film.html`.

## Creative calls

- Built storyline A. Not built: B (Same Draft, Twice) and C (The Dot Gets Around). See `STORYLINES.md`.
- Bryce chose no voice. No music either: HeyGen isn't installed and there's no local music model.
- The extension's preview rewrite was replaced because it invented "Monday's review" and "the second phase".
- On screen is a real `rewrite()` result from `qwen2.5` that passed every check (`unverified: []`). It is the
  best of 17 runs: 6 passed the checks, and only this one also avoided repeating the contradiction or adding
  a Q2 comparison. Bryce chose to show it with the label "Example, best of several runs".
- The three questions are the preview page's sample questions, shown in the real panel. The film's word-morph
  into the box is a dramatisation: the real product replaces the text at once.

## Measured

- `check` passes with 0 errors. Sound hits land about 40 ms after each click. Rendered file: -21.2 LUFS,
  true peak -6.7 dB, no clipping. Quieter than the -16 to -14 LUFS social target, kept because it has effects only.
- Frames pulled from the finished MP4 at 0, 2, 10.5, 18, 22 and 28.5 s.

## Looked at only

Contact sheets and the 360 px phone sheet. Nobody has heard the sound.

## Weakest shot

The panel on a phone: panel text is small at 360 px, though captions and the story still read. With more
time, punch in on the panel during Q2.

## Warnings kept on purpose

- `line_unread`: panel screens are product UI that the viewer skims, and pressed states last 0.35 s by design.
  The Q1, Q2 and Q3 questions hold 2.6, 3.25 and 1.85 s.
- `timeline_track_too_dense`: one-take film, kept in one composition so the dot and words stay continuous.
- `text_below_floor`: the panel's small labels at 2.4x during the shrunk layout.
