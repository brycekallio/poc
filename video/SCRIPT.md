# Voiceover script: P.O.C 30-second demo

**Status:** voiced with Bryce's ElevenLabs clone (2026-11-12, see "Voice as dropped in" below). Draft for Bryce's approval.
**Length:** 71 words over 29.6 s, about 2.4 words a second (calm pace; nothing is faster than 3.5 a second).

| Time (s) | Line (say it exactly like this) | On screen |
| --- | --- | --- |
| 0.25 – 2.9 | Short, but cover everything? Can't have both. | The draft, its contradiction in ink |
| 3.0 – 6.0 | P.O.C sits by your cursor. Click Coach this draft. | Dot appears, panel opens, click |
| 6.1 – 9.1 | It asks about your words: who is this for? | Question 1 of 3 |
| 9.4 – 12.7 | Where your draft contradicts itself, you choose what you meant. | Question 2 of 3 |
| 13.0 – 16.1 | One more about the numbers, then Rewrite. | Question 3, summary, Rewrite |
| 16.4 – 18.45 | Then it rewrites the prompt. | The rewrite in the panel |
| 19.0 – 22.6 | Right in the chat box. Same request, now it's clear. | Words move into the box |
| 22.6 – 24.9 | _(pause)_ | Hold on the clear prompt |
| 24.9 – 27.0 | It asks first. Then it rewrites. | End card (its own text is the caption) |
| 27.1 – 29.4 | Free with Ollama, or use your own key. | End card subline and GitHub link |

Say "P.O.C" as three letters, "pee oh see". Every claim is one the README already makes.

## Voice as dropped in (2026-11-12)

ElevenLabs voice `91jhZaqO949C1LvHzeUa` (Bryce's clone), model eleven_v4, one take of all nine lines (flow
https://elevenlabs.io/app/flows/yOq0W6tUIxRWkRyC02I0, take 2 of 2, 25.6 s). The prompt spelled "P.O.C" as "Pee oh see" so it is
read as three letters; the captions still show "P.O.C". `assets/voiceover.mp3` is that take cut at the line boundaries and
each line placed at its table start, with two moves: lines 1 and 2 run about 0.5 s over their windows, so they are eased
to 1.07x tempo and line 2 starts at 3.3 s instead of 3.0 (line 3 at 6.6, a touch after the table). Captions use the take's
own word times mapped through that placement (`assets/transcript.json`), via `node tools/captions.mjs assets/transcript.json`.

## Re-dropping a new voice

The audio is `<audio id="voiceover" src="assets/voiceover.mp3">` in `index.html` (29.6 s; keep the name and length and nothing else moves).

1. In ElevenLabs, generate the lines above with your cloned voice as **one take**, pacing to the times in the table
   (or generate line by line and place each one at its start time in any editor). Export MP3.
2. Save it over `video/assets/voiceover.mp3` (same name). Trim or pad to about 29.6 s.
3. Re-time the captions to your real words:
   ```bash
   cd video
   npx hyperframes transcribe assets/voiceover.mp3 --model small.en
   node tools/captions.mjs assets/transcript.json   # matches words by position, so say the script word for word
   ```
4. `npx hyperframes check`, then `npx hyperframes render -o renders/poc-demo.mp4 --crf 20`,
   copy it to `site/media/demo.mp4`, and run `bash docs/make-gif.sh` for the README GIF.

To change the words before recording: edit `script.json`, run `node tools/captions.mjs`, and update this table.
