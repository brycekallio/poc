# POC — Prompt Optimization Coach

Two pieces:

| | |
|---|---|
| `extension/` | Chrome MV3 extension. The actual product. Build, then load `extension/dist` unpacked. |
| `site/` | Static marketing page, deployed to Netlify. |

No backend, no auth, no database. Users bring their own Anthropic API key, stored in
`chrome.storage.local` and read only by the extension's service worker.
