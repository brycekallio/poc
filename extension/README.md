# POC — extension

```bash
npm install
npm run build        # or: npm run watch
```

Then `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/dist`
(not this folder: Chrome refuses `node_modules`). The setup page opens by itself on first install.
After each rebuild, hit reload on the extension card; open tabs pick up the new version by themselves.

While you write in any multi-line text box, a small dot sits beside your caret. Hover it to open **P.O.C**, then click **Coach this draft**. **Cmd+Shift+P** coaches straight away. **Esc** closes it.
Rebind at `chrome://extensions/shortcuts`.

## Layout

| | |
|---|---|
| `src/content.js` | Host plumbing: reads the prompt box, sends the draft to the worker, tells the panel what to show. Never sees the key. |
| `src/panel.js`, `src/panel.css` | The caret dot and the popup (shadow DOM), every state. No Chrome APIs, so `dev/` can render it. |
| `src/caret.js` | Finds the caret on screen without touching the host editor. |
| `src/fonts.js` | Registers the bundled Geist on the host document via `FontFace` (shadow roots ignore `@font-face`; host CSP can block font URLs). |
| `src/hosts.js` | Every per-site selector. The first file to fix when a host breaks. |
| `src/worker.js` | Service worker. Owns the key, the hotkey, and every API call. |
| `src/coach.js` | The model calls and the system prompt. Shared with `scripts/try-diagnose.mjs`. |
| `src/options.js`, `static/options.html` | Key and model settings, plus a "Test key" round-trip. |
| `static/manifest.json` | Copied into `dist/` by `build.mjs`. |

## Looking at P.O.C without Chrome

```bash
npm run demo         # then open preview/demo.html (type, hover the dot)
```

Add `?state=idle|loading|question|summary|error|nothing` for a fixed state. It is one
self-contained file (script and fonts inlined), so it opens straight from disk. `preview/` is
gitignored.

## Tuning the questions without Chrome

```bash
ANTHROPIC_API_KEY=sk-ant-… npm run try -- "your draft prompt"
ANTHROPIC_API_KEY=sk-ant-… npm run try -- --file draft.txt --model claude-opus-5-5
```

This prints the hidden diagnosis next to the questions. When a question comes back generic,
read the diagnosis first. In Chrome, the same diagnosis is logged to the service worker's console
(`chrome://extensions` → POC → "service worker").

## Two things to know
- **Invoked, not ambient.** POC only appears when summoned. A coach that interrupts mid-typing does not survive daily use.
- **Selectors will break.** `src/hosts.js` holds every DOM hook in one place because these sites change markup without notice. When a host stops working, that file is the only thing to fix.
