# Chrome Web Store listing

Everything the developer dashboard asks for, ready to paste.
Upload `extension/poc-extension.zip` (`npm run package`). Screenshots are 1280×800 in `screenshots/`. The 128×128 icon is `extension/static/icons/icon-128.png`.

## Publishing, in order

1. Register at https://chrome.google.com/webstore/devconsole (one-time $5 fee).
2. Click **New item** and upload the zip.
3. Paste the fields below and upload the screenshots.
4. Host `PRIVACY.md` at a public URL (the repo must be public, or put it on the site) and paste that URL.
5. Submit. Broad site access means a manual review, which can take a few days to a few weeks.

## Store listing

**Name:** P.O.C — Prompt Optimization Coach

**Summary (132 characters max):** Sharpen what you write in any text box. Quick questions, then a better draft. Free with Ollama, or use your own AI key.

**Category:** Productivity → Tools

**Language:** English

**Description:**

P.O.C is a small coach that lives in every text box in Chrome.

Write a draft and hover the dot beside your cursor. P.O.C asks a few quick questions about what only you know, like who it's for and what matters most, then writes a sharper version back into the box.

• Works everywhere you write: ChatGPT, Claude, Gemini, Gmail, GitHub comments and any multi-line text box.
• Knows who is reading: prompts for an AI get prompt coaching, and messages for people get clearer, shorter writing.
• Never interrupts: nothing is sent until you click Coach this draft.
• One switch: click the toolbar icon to turn it on or off everywhere.

Free or bring your own key:
• Free and private with Ollama, which runs on your own computer. The setup guide walks you through it.
• Or use your own key from Anthropic, OpenAI or Google Gemini, or any OpenAI-compatible server.

No account, no subscription, no analytics. P.O.C has no server. Your keys stay in your browser, and your text goes only to the AI you choose.

## Privacy practices tab

**Single purpose:** Helps the user improve the text they are writing in a text box, by asking clarifying questions and rewriting the draft.

**Permission justifications:**

- **Host permissions (all sites):** The coach appears in multi-line text boxes on whichever site the user is writing, so it cannot be limited to a fixed list. Access is also needed to reach the AI provider the user chose, including a server they run themselves.
- **storage:** Keeps the user's chosen provider, model, API keys and on/off setting on their device.
- **scripting:** Starts the coach in tabs that were already open when the extension was installed or updated.
- **declarativeNetRequestWithHostAccess:** Removes the Origin header only from requests this extension makes to localhost, because Ollama rejects requests from extensions otherwise. Web pages are not affected.

**Remote code:** No. All code ships in the package.

**Data usage:** Check "Website content" (the draft the user asks to be coached) and "Authentication information" (the user's own API keys, stored on their device). Certify: not sold to third parties, not used for unrelated purposes, not used for creditworthiness.

**Privacy policy URL:** the public address of `PRIVACY.md`.
