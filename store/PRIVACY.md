# P.O.C privacy policy

Last updated: 2026-10-30

P.O.C (Prompt Optimization Coach) is a browser extension that helps you improve what you're writing. It has no server, no account and no analytics. Its developer never receives your text, your keys or any data about you.

## What P.O.C reads

P.O.C reads the multi-line text box you are typing in, inside your browser, so it can show its dot beside your cursor. It doesn't read other parts of the page.

## What P.O.C sends, and where

Nothing is sent until you click **Coach this draft** or press the shortcut. Then your draft, your answers and the name of the website you're on go to the one AI provider you chose:

- **Ollama or another local server:** stays on your computer.
- **Anthropic, OpenAI, Google Gemini, or a server you configure:** sent directly from your browser to that provider, under its own privacy policy and your agreement with it.

## What P.O.C stores

These are kept in your browser's local extension storage: your chosen provider and model, any API keys you enter, the on/off setting, and the "Other" server address if you set one. They aren't synced to your Google account, and removing the extension deletes them.

## Why it asks for these permissions

- **Access to all websites:** to show the dot in text boxes on any site, and to reach the provider you chose.
- **Storage:** to keep the settings above.
- **Scripting:** to start in tabs that were already open when you installed it.
- **Modify network requests on your computer:** only requests P.O.C itself makes to a local server such as Ollama, which otherwise refuses browser extensions.

## Contact

Questions: open an issue at https://github.com/brycekallio/poc/issues
