# AGENTS.md — AI Agent Reference for oc-inspector

> This file is for AI coding agents (Cursor, Copilot, Claude, etc.) working on this project.
> It contains architecture, conventions, and context in a format optimized for LLM consumption.

## Project Identity

- **Name:** `oc-inspector`
- **npm:** `oc-inspector` (unscoped)
- **Repo:** https://github.com/kshidenko/openclaw-inspector
- **License:** MIT
- **Author:** @kshidenko
- **Node:** >= 18, ESM only (`"type": "module"`)
- **Single runtime dependency:** `ws` (WebSocket)

## What This Project Does

A transparent HTTP reverse proxy that sits between [OpenClaw](https://openclaw.ai) and LLM providers (Anthropic, OpenAI, BytePlus, Ollama, etc.). It intercepts all API traffic to:

1. **Track token usage** per request, model, and provider
2. **Calculate costs** using built-in or user-defined pricing
3. **Display** everything in a real-time web dashboard and CLI
4. **Persist** daily usage history to disk

It works by patching `~/.openclaw/openclaw.json` to route provider `baseUrl`s through `http://127.0.0.1:18800/{provider}/...`, then forwarding to the real upstream.

## Architecture Overview

```
User → OpenClaw → Inspector Proxy (port 18800) → Real Provider API
                       ↕ WebSocket
                   Web Dashboard
```

### Request Flow

1. OpenClaw sends request to `http://127.0.0.1:18800/{provider}/chat/completions`
2. `proxy.mjs` extracts provider name from URL, looks up real upstream in target map
3. Request is forwarded to upstream with original headers (auth, content-type)
4. Response is captured: buffered (JSON) or streamed (SSE)
5. Token usage is parsed from response using provider-specific parsers
6. Cost is calculated, entry is stored, WebSocket broadcasts to dashboard
7. Usage is recorded to daily history file

### Config Patching Flow

1. `enable()` in `config.mjs` backs up `openclaw.json`, rewrites `baseUrl` for each provider to proxy URL
2. `disable()` restores original URLs from saved state (`.inspector-state.json`)
3. `stop` / SIGINT / SIGTERM automatically call `disable()` before exit

## File Map

```
bin/cli.mjs          CLI entry point. Arg parsing, daemon management (start/stop/restart),
                     subcommands (stats, history, pricing, providers, config, logs, help),
                     live stats TUI, all print/format functions.

src/server.mjs       HTTP server. Combines proxy, WebSocket, dashboard, and REST API endpoints.
                     Initializes pricing, history, and proxy on startup.

src/proxy.mjs        Reverse proxy core. Routes /{provider}/{path} → upstream.
                     Handles SSE streaming, buffers responses, extracts usage,
                     calculates cost, records to history. Circular buffer of 500 entries.

src/config.mjs       OpenClaw config manager. detect(), enable(), disable(), status().
                     Patches/restores openclaw.json. Double-enable protection.
                     Emergency cleanProxyUrls() fallback.

src/providers.mjs    Provider registry. BUILTIN_URLS map (20+ providers),
                     detectApiFamily() (anthropic vs openai format),
                     detectActiveProviders() (reads auth-profiles.json),
                     buildTargetMap() (merges builtin + config providers).

src/pricing.mjs      Model pricing. BUILTIN_PRICING for 50+ models.
                     initPricing() loads: builtins → openclaw.json costs → .inspector.json overrides.
                     calculateCost() computes USD from tokens + rates.

src/history.mjs      Persistent daily stats. Stores JSON files in ~/.openclaw/.inspector-history/.
                     recordRequest(), getDay(), getRecent(), listDates().

src/usage-parsers.mjs  Token extraction from API responses.
                     parseAnthropicUsage(), parseOpenAIUsage(), parseGenericUsage(),
                     accumulateStreamUsage() for SSE events.

src/dashboard.mjs    Single-string HTML/CSS/JS for the web UI.
                     renderDashboard(port) returns complete HTML page.
                     WebSocket client, Enable/Disable toggle, collapsible messages,
                     history panel, cost display.

src/ws.mjs           WebSocket server. initWebSocket(), broadcast(), client management.
                     Sends entry summaries on connect, full entry on detail request.
```

## Key Data Structures

### Entry (proxy.mjs)
```js
{
  id: "uuid",
  provider: "anthropic",        // extracted from URL path
  method: "POST",
  path: "/v1/messages",         // path after provider prefix
  timestamp: "2026-02-06T...",
  state: "done" | "streaming" | "error",
  status: 200,
  duration: 1234,               // ms
  reqBody: { ... },             // parsed request JSON
  resBody: { ... },             // parsed response JSON (buffered only)
  sseEvents: [ ... ],           // array of SSE event objects (streaming only)
  usage: {
    model: "claude-sonnet-4-5",
    inputTokens: 1000,
    outputTokens: 500,
    cachedTokens: 800,
    cacheCreatedTokens: 0,
    totalTokens: 1500,
  },
  cost: 0.0123,                 // USD, calculated by pricing.mjs
  reqModel: "claude-sonnet-4-5", // from request body (fallback if usage.model missing)
}
```

### Daily History (history.mjs)
```js
// ~/.openclaw/.inspector-history/2026-02-06.json
{
  totalRequests: 42,
  totalInputTokens: 125000,
  totalOutputTokens: 45000,
  totalCachedTokens: 80000,
  totalCost: 1.2345,
  totalErrors: 0,
  byProvider: { "anthropic": { requests, inputTokens, outputTokens, cachedTokens, cost, errors } },
  byModel: { "claude-sonnet-4-5": { requests, inputTokens, outputTokens, cachedTokens, cost, provider } },
  lastUpdated: "2026-02-06T19:03:39.414Z"
}
```

### Inspector State (.inspector-state.json)
```js
{
  enabled: true,
  port: 18800,
  timestamp: "2026-02-06T...",
  originals: {
    "byteplus": { baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3", wasCustom: true },
    "anthropic": { baseUrl: "https://api.anthropic.com", wasCustom: false }
  },
  backupPath: "/Users/.../.openclaw/openclaw.json.inspector-backup"
}
```

## Runtime Paths

| Path | Purpose |
|------|---------|
| `~/.openclaw/openclaw.json` | OpenClaw main config (patched by enable/disable) |
| `~/.openclaw/.inspector-state.json` | Stores original URLs for restore |
| `~/.openclaw/.inspector.json` | User config (custom pricing overrides) |
| `~/.openclaw/.inspector-history/` | Daily usage JSON files |
| `~/.openclaw/.inspector-runtime/inspector.pid` | Daemon PID |
| `~/.openclaw/.inspector-runtime/inspector.log` | Daemon stdout/stderr |

## API Endpoints (src/server.mjs)

| Route | Method | Returns |
|-------|--------|---------|
| `/` | GET | Dashboard HTML |
| `/api/status` | GET | `{ enabled, providers, port }` |
| `/api/enable` | POST | `{ ok, message, providers }` |
| `/api/disable` | POST | `{ ok, message }` |
| `/api/stats` | GET | Aggregated stats + recentEntries |
| `/api/history?days=N` | GET | `{ days: [...], dates: [...] }` |
| `/api/history/:date` | GET | Single day stats |
| `/api/pricing` | GET | `{ models: [...] }` |
| `/api/config` | GET | `{ config, configPath }` |
| `/api/providers` | GET | `{ providers: [{ name, url }] }` |
| `/api/clear` | POST | `{ ok: true }` |
| `/{provider}/**` | ANY | Proxied to upstream |

## CLI Commands (bin/cli.mjs)

| Command | Type | Description |
|---------|------|-------------|
| `start` (default) | daemon | Spawn background process, write PID |
| `stop` | daemon | Disable interception + kill process |
| `restart` | daemon | stop + start |
| `run` | foreground | Interactive mode (Ctrl+C to stop) |
| `_serve` | hidden | Actual server process (used by daemon) |
| `enable` | local | Patch config, restart gateway |
| `disable` | local | Restore config, restart gateway |
| `status` | local | Show daemon + interception state |
| `stats` | remote | GET /api/stats (supports --live) |
| `history` | remote | GET /api/history |
| `pricing` | remote | GET /api/pricing |
| `providers` | remote | GET /api/providers |
| `config` | remote | GET /api/config |
| `logs` | local | Read daemon log file |
| `help` | local | Print command reference |

**"remote"** commands talk to a running inspector via HTTP.
**"local"** commands read/write files directly.

## Provider Detection

Two API families are supported:

- **Anthropic format**: `anthropic`, `minimax`, `zai` — uses `message_start`, `content_block_delta`, `message_delta` SSE events, `usage.input_tokens` / `output_tokens`
- **OpenAI format**: everything else — uses `choices[0].delta`, `usage.prompt_tokens` / `completion_tokens`

Detection is in `providers.mjs → detectApiFamily()`.

## Pricing Resolution

Priority (highest wins):
1. `~/.openclaw/.inspector.json` → `pricing` section
2. `openclaw.json` → `models.providers.*.models[].cost`
3. `BUILTIN_PRICING` in `pricing.mjs` (50+ models hardcoded)

All prices are **USD per 1M tokens**. Fields: `input`, `output`, `cacheRead`, `cacheWrite`.

## Known Gotchas

1. **URL construction**: `new URL(path, base)` drops the base path if `path` starts with `/`. We concatenate manually: `new URL(base.replace(/\/?$/, "") + rest)`.

2. **Double enable**: Clicking Enable twice used to overwrite originals with proxy URLs. Now guarded by checking existing state.

3. **Backup corruption**: Backup is only created if one doesn't already exist (prevents overwriting clean backup with patched config).

4. **Port kill on startup**: `server.mjs` runs `lsof -ti :PORT | xargs kill -9` before listen to avoid EADDRINUSE.

5. **Dashboard is a single string**: `dashboard.mjs` exports one giant template literal. All HTML/CSS/JS is inline. No build step, no bundler.

6. **SSE parsing**: Anthropic sends `event:` + `data:` pairs. OpenAI sends only `data:` lines. Both end with `data: [DONE]`. The proxy collects all SSE events in `entry.sseEvents[]`.

## Code Conventions

- **ESM only** — all files use `import`/`export`, file extension `.mjs`
- **No build step** — runs directly with Node.js
- **JSDoc on every export** — Google-style docstrings with `@param`, `@returns`, `@example`
- **ANSI formatting** — CLI output uses raw `\x1b[...m` codes, constants in `E` object in cli.mjs
- **Error handling** — try/catch with silent fallbacks for non-critical operations
- **No TypeScript** — plain JavaScript with JSDoc type hints

## Testing

No test framework currently. Test manually:

```bash
# Start and verify
node bin/cli.mjs run --open

# In another terminal
node bin/cli.mjs stats
node bin/cli.mjs enable
node bin/cli.mjs disable
node bin/cli.mjs status
```

## Publishing

Automated via GitHub Actions (`.github/workflows/npm-publish.yml`):
1. Create a GitHub Release (tag `vX.Y.Z`)
2. CI runs `npm publish --provenance --access public`
3. Requires `NPM_TOKEN` secret in repo settings

Manual version bump before release:
```bash
npm version patch|minor|major --no-git-tag-version
git add -A && git commit -m "chore: bump version"
git push
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
```
