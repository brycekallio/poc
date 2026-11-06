# Hosted providers from the Mac app's web view (origin app://poc)

Probed 2026-11-06 with curl, `Origin: app://poc`, an invalid key (`sk-invalid-test`) only. The page can read a
reply only if it carries `Access-Control-Allow-Origin` on the real response, not just on the preflight.

| Provider | Preflight (OPTIONS) | Real POST reply (401/400) | Verdict |
|---|---|---|---|
| Anthropic (`api.anthropic.com`) | 200, ACAO `*`, allows x-api-key / anthropic-* headers | 401 with ACAO `*` (needs the SDK's `anthropic-dangerous-direct-browser-access`, which it sends) | OK, direct |
| OpenAI (`api.openai.com`) | 200, ACAO `app://poc` | 401 with NO ACAO: the page sees a network error | BLOCKED, routed through Swift |
| Gemini (`generativelanguage.googleapis.com/v1beta/openai`) | 200, ACAO `app://poc` | 400 with ACAO `app://poc` | OK, direct |
| OpenAI-compatible (Groq as sample) | 204, ACAO `*` | 401 with ACAO `*` | OK, direct (other servers vary) |

Fix: `webkit.messageHandlers.net` (`NativeFetch` in `Sources/POCEngine/WebCoachEngine.swift`, hosts listed in
`NATIVE_HOSTS` in `extension/src/desktop.js`). https and `api.openai.com` only; every other URL is refused. The reply arrives whole,
so OpenAI rewrites appear at once instead of streaming. Tests: `HostedProviderTests` (live, invalid key; runs only with `POC_LIVE_TESTS=1`)
and `NativeFetchTests`.

Unresolved: a user-chosen OpenAI-compatible server that sends no CORS headers will still fail as "network".
