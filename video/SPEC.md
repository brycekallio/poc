# SPEC: Not Too Long But Cover Everything

GOAL: a stranger recognises their own vague draft, sees P.O.C ask about it, and goes to the GitHub link.
OUTPUT: HyperFrames, 1920x1080, 30 fps.
TIME: 29.6 s x 30 = 888 frames. No music: the clock is the cursor's clicks.

LOOK:
- Ground #ffffff, flat, no texture. Ink #0a0a0a, muted #6b6b6b, raised #f2f2f2.
- One accent, the product's own hue #1d5fbf: the dot, the quote bar, the box's focus ring. Nothing else.
- Geist 600 for captions at 56 px, tracking -1%. Draft text Geist 400 at 68 px, line-height 1.3.
- The medium is P.O.C's own panel CSS (`src/panel.css`, tokens copied exact) scaled 2.4x, so 12 px UI text
  is 28.8 px. Panel shadow is the product's own `--float`, scaled with it. No other shadows.

OBJECTS:
- The composer: a 1728 px box, 3 px #1d5fbf ring, 44 px radius, holding the draft.
- The dot: the real orb and wordmark, at 3x inside the composer.
- The panel: real markup from the extension's preview page, in each real state.
- The cursor: a black arrow with a white edge, 56 px tall.

MOTION:
- Enter `expo.out`, camera and layout `power2.inOut`, exit `power3.in`. Panel opens with the product's own
  `pop`, scale 0.96 to 1 in 5 frames.
- Clicks press the target to 0.98 for 3 frames. Option turns ink the same frame as the click.

SHOTS (frame ranges below predate the retime to 29.6 s; `tools/gen.mjs` holds the final clock):
- 0-90 Draft fills the frame. Everything but the contradiction greys. Reads "You can't have both." Sound: none.
- 90-165 Draft returns to ink. Dot pops at the caret. Reads "P.O.C sits by your cursor." Sound: pop.
- 165-250 Cursor enters, hovers. Composer shrinks left, panel opens. Clicks Coach this draft. Sound: click.
- 250-345 Skeleton, then Q1 of 3. "for the team" is carried from the draft into the quote. Reads "It asks about
  your words." Answers Leadership. Sound: pop, click.
- 345-490 Q2 of 3. The contradiction is carried into the quote, the hook paid off. Reads "You choose what you
  meant." Answers Short body. Sound: pop, click.
- 490-560 Q3 of 3, answered Q3 alone. Sound: click.
- 560-610 Summary, click Rewrite. Sound: click.
- 610-690 Skeleton, then the rewrite with its technique chips. Reads "Then it rewrites." Sound: pop on the panel.
- 690-790 Use this clicked. Panel closes, composer returns to full frame, kept words travel to their new places,
  new words land. Reads "Same request. Now it's clear." Sound: key ticks, click.
- 790-825 and end card: the caret dot is carried to centre and becomes the o of the wordmark. Riser into it.

BANNED: dark void, glow, gradients, cream ground, serif, mono caps labels, docked logo, titles that move after
landing, fade-and-slide on everything, click rings, breathing loops, any claim the README does not make, and any
rewrite text not produced by P.O.C's real code.

QA: frame 0 thumbnail shows the whole draft; frame 60 the contradiction alone in ink; frame 240 the panel at full
size beside the shrunk composer with no overlap; frame 400 Q2 with the quote; frame 650 the rewrite panel readable;
frame 770 the rewrite full frame; frame 815 the end card with the GitHub address.
