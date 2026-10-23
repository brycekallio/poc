# POC — Prompt Optimization Coach

Two pieces:

| | |
|---|---|
| `extension/` | Chrome MV3 extension. The actual product. Load unpacked. |
| `site/` | Static marketing page, deployed to Netlify. |

No Clerk and no Supabase yet — a local-only extension has nobody to authenticate. Both arrive with the coaching backend, and **that decision is the gate**: users bring their own API key (free for you, high friction, most people bail) or you proxy through a backend (smooth, but you pay per call and need abuse limits). See `../CLAUDE.md`.
