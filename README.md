# oc-inspector

[![npm](https://img.shields.io/npm/v/oc-inspector)](https://www.npmjs.com/package/oc-inspector) [![license](https://img.shields.io/github/license/kshidenko/openclaw-inspector)](LICENSE) [![AI Agents](https://img.shields.io/badge/AI_Agents-AGENTS.md-blue)](AGENTS.md)

A debugging and monitoring tool for [OpenClaw](https://openclaw.ai) that helps you understand **where your tokens and money are going**.

When working with LLM agents you often have no visibility into what's actually happening under the hood — how many tokens each request burns, which models cost the most, what system prompts look like, how tool calls are structured. `oc-inspector` sits between OpenClaw and your LLM providers as a transparent proxy, capturing every request and response in real time so you can see the full picture: token usage, costs, message flow, thinking blocks, tool calls — everything in a clear, human-readable format.

Use it to:
- **Debug** agent behavior by inspecting actual API requests and responses
- **Find token leaks** — see which conversations, models, or providers consume the most
- **Track costs** — per-request, per-model, per-day breakdowns with persistent history
- **Understand** what OpenClaw sends to each provider (system prompts, tool definitions, context)

> **⚠️ USE AT YOUR OWN RISK**
>
> This tool works by patching `openclaw.json` to route API traffic through a local proxy. While it includes safeguards (automatic config restore on stop/shutdown, backup files, double-enable protection), **always keep a manual backup of your `openclaw.json` before using the inspector**:
>
> ```bash
> cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.manual-backup
> ```
>
> If something goes wrong, restore it:
>
> ```bash
> cp ~/.openclaw/openclaw.json.manual-backup ~/.openclaw/openclaw.json
> openclaw gateway restart
> ```

## Quick Start

```bash
npx oc-inspector
```

Starts the inspector daemon in background on `localhost:3000` with a live web dashboard.

---

## Features

| Feature | Description |
|---------|-------------|
| **One-click enable/disable** | Patches `openclaw.json` automatically — no manual editing required |
| **All providers** | Anthropic, OpenAI, BytePlus, Ollama, Groq, Mistral, xAI, Google, OpenRouter, DeepSeek, and any custom provider |
| **Real-time dashboard** | WebSocket-powered live view of every API request and response |
| **Token tracking** | Accurate token counts for streaming (SSE) and non-streaming responses |
| **Cost estimation** | Per-request and aggregate cost based on model pricing |
| **Custom pricing** | Override built-in prices or add your own models via `.inspector.json` |
| **Message inspector** | Collapsible view of system prompts, tool calls, thinking blocks, and full conversation history |
| **Persistent history** | Daily usage stats saved to disk — survives restarts |
| **CLI tools** | Stats, history, pricing, providers, status — all from the command line |
| **Zero dependencies on OpenClaw internals** | Works as a standalone reverse proxy |

---

## Installation

### Via npx (recommended, no install)

```bash
npx oc-inspector
```

### Global install

```bash
npm install -g oc-inspector
oc-inspector
```

### From source

```bash
git clone https://github.com/kshidenko/openclaw-inspector.git
cd openclaw-inspector
npm install
npm link
oc-inspector
```

---

## Usage

### Start the inspector

```bash
# Start as background daemon (default) — terminal is free immediately
npx oc-inspector

# Start in foreground (interactive, for debugging)
npx oc-inspector run

# Custom port
npx oc-inspector --port 9000

# Auto-open browser
npx oc-inspector --open

# Custom OpenClaw config path
npx oc-inspector --config /path/to/openclaw.json
```

### Stop / Restart

```bash
# Stop the background daemon
oc-inspector stop

# Restart
oc-inspector restart
```

### Autostart (run on login/boot)

```bash
# Install autostart service (launchd on macOS, systemd on Linux)
oc-inspector install

# Install with custom port
oc-inspector install --port 9000

# Remove autostart
oc-inspector uninstall

# Check autostart status
oc-inspector status
```

The inspector will start automatically when you log in (macOS) or boot (Linux), and restart if it crashes.

### CLI Commands

| Command | Description |
|---------|-------------|
| `start` | Start inspector as a background daemon (default) |
| `stop` | Stop the running daemon |
| `restart` | Restart the daemon |
| `run` | Start in foreground (interactive mode, for debugging) |
| `enable` | Enable interception — patches `openclaw.json` and restarts the gateway |
| `disable` | Disable interception — restores original config |
| `status` | Show daemon + interception status |
| `stats` | Show live token usage and cost statistics |
| `history` | Show daily usage history (persisted across restarts) |
| `pricing` | Show model pricing table (built-in + custom overrides) |
| `providers` | List detected providers and their upstream URLs |
| `config` | Show `.inspector.json` path and contents |
| `logs` | Show daemon log output |
| `install` | Install autostart — run inspector on login/boot |
| `uninstall` | Remove autostart service |

### Examples

```bash
# Start and forget
oc-inspector start

# Quick stats from a running inspector
oc-inspector stats

# JSON output for scripting
oc-inspector stats --json

# Last 30 days of usage
oc-inspector history --days 30

# View pricing table
oc-inspector pricing

# Check daemon + interception status
oc-inspector status

# View last 100 log lines
oc-inspector logs --lines 100
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--port <number>` | Port for the inspector proxy | `3000` |
| `--open` | Auto-open the dashboard in a browser | `false` |
| `--config <path>` | Custom path to `openclaw.json` | `~/.openclaw/openclaw.json` |
| `--json` | Output as JSON (for `stats`, `status`, `providers`, `history`, `pricing`) | `false` |
| `--days <number>` | Number of days to show in `history` command | `7` |
| `--lines <number>` | Number of log lines to show in `logs` command | `50` |
| `--help`, `-h` | Show help message | — |

---

## How It Works

1. **Start** — `oc-inspector` launches a background daemon with an HTTP reverse proxy on `localhost:3000`. The terminal is free immediately.
2. **Enable** — Click **Enable** in the web UI (or run `oc-inspector enable`). This:
   - Backs up `openclaw.json`
   - Rewrites each provider's `baseUrl` to route through `http://127.0.0.1:3000/{provider}/...`
   - Restarts the OpenClaw gateway
3. **Intercept** — All LLM API traffic flows through the inspector:
   - Requests/responses are logged in real time
   - Token usage is extracted from response headers and SSE events
   - Costs are calculated and aggregated
4. **Disable** — Click **Disable** (or run `oc-inspector disable`) to restore the original config and restart the gateway

---

## Configuration

### Custom Pricing

By default, `oc-inspector` ships with built-in pricing for 50+ popular models from Anthropic, OpenAI, Google, Groq, Mistral, xAI, and DeepSeek. You can **override** any model's pricing or **add new models** using the `.inspector.json` config file.

#### Config file location

```
~/.openclaw/.inspector.json
```

#### Pricing format

Prices are specified as USD per **1 million tokens**:

```json
{
  "pricing": {
    "my-custom-model": {
      "input": 0.5,
      "output": 2.0,
      "cacheRead": 0.1,
      "cacheWrite": 0.6
    },
    "claude-sonnet-4-5": {
      "input": 3,
      "output": 15,
      "cacheRead": 0.3,
      "cacheWrite": 3.75
    },
    "ep-my-byteplus-endpoint": {
      "input": 0.25,
      "output": 2.0,
      "cacheRead": 0.05,
      "cacheWrite": 0
    }
  }
}
```

#### Pricing resolution order

Pricing is resolved in this order (highest priority first):

1. **`.inspector.json` → `pricing`** — User overrides (always win)
2. **`openclaw.json` → `models.providers.*.models[].cost`** — Per-model costs defined in OpenClaw config
3. **Built-in defaults** — Hardcoded pricing for well-known models

This means you can:
- Override built-in prices if they're outdated
- Add pricing for custom/private models (e.g., BytePlus endpoints like `ep-xxxx`)
- Set `0` for models you don't want to track cost for

#### Cost fields

| Field | Description |
|-------|-------------|
| `input` | Cost per 1M **input** tokens (prompt) |
| `output` | Cost per 1M **output** tokens (completion) |
| `cacheRead` | Cost per 1M **cache-read** tokens (prompt caching hits) |
| `cacheWrite` | Cost per 1M **cache-write** tokens (prompt caching misses) |

All fields are optional and default to `0`.

#### View current pricing

```bash
# Pretty table
oc-inspector pricing

# JSON (for scripting)
oc-inspector pricing --json
```

### Models with built-in pricing

<details>
<summary>Click to expand full list</summary>

**Anthropic** — Claude Opus 4.6, 4.5, 4.1, 4 · Sonnet 4.5, 4 · Haiku 4.5, 3.5

**OpenAI** — GPT-5.2, 5.1, 5, 5-mini, 5-nano · GPT-4.1, 4.1-mini, 4.1-nano · GPT-4o, 4o-mini · o3, o4-mini, o3-mini, o1, o1-mini

**Google** — Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash

**Groq** — LLaMA 3.3-70B, 3.1-8B

**Mistral** — Mistral Large, Small

**xAI** — Grok 3, Grok 3 Mini

**DeepSeek** — DeepSeek Chat, Reasoner

</details>

---

## Persistent History

Usage stats are automatically saved to disk in daily JSON files:

```
~/.openclaw/.inspector-history/
  2026-02-06.json
  2026-02-05.json
  ...
```

Each file contains aggregate totals and per-provider/per-model breakdowns:

```json
{
  "totalRequests": 42,
  "totalInputTokens": 125000,
  "totalOutputTokens": 45000,
  "totalCachedTokens": 80000,
  "totalCost": 1.2345,
  "totalErrors": 0,
  "byProvider": { ... },
  "byModel": { ... },
  "lastUpdated": "2026-02-06T19:03:39.414Z"
}
```

View history from the CLI:

```bash
oc-inspector history           # Last 7 days
oc-inspector history --days 30 # Last 30 days
oc-inspector history --json    # Machine-readable
```

Or open the **History** tab in the web dashboard for a visual breakdown with charts.

---

## API Endpoints

The inspector exposes a JSON API on the same port as the dashboard:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Interception status |
| `/api/enable` | POST | Enable interception |
| `/api/disable` | POST | Disable interception |
| `/api/stats` | GET | Live token usage and cost stats |
| `/api/history?days=N` | GET | Daily history for last N days |
| `/api/history/:date` | GET | History for a specific date (YYYY-MM-DD) |
| `/api/providers` | GET | Active providers and upstream URLs |
| `/api/pricing` | GET | Full pricing table |
| `/api/config` | GET | Inspector config file contents |
| `/api/clear` | POST | Clear in-memory request log |

---

## Supported Providers

| Provider | API Format | Built-in URL |
|----------|------------|--------------|
| Anthropic | Anthropic Messages | `api.anthropic.com` |
| OpenAI | OpenAI Completions | `api.openai.com/v1` |
| Google Gemini | OpenAI-compatible | `generativelanguage.googleapis.com/v1beta` |
| Groq | OpenAI-compatible | `api.groq.com/openai/v1` |
| Mistral | OpenAI-compatible | `api.mistral.ai/v1` |
| xAI (Grok) | OpenAI-compatible | `api.x.ai/v1` |
| OpenRouter | OpenAI-compatible | `openrouter.ai/api/v1` |
| Cerebras | OpenAI-compatible | `api.cerebras.ai/v1` |
| HuggingFace | OpenAI-compatible | `api-inference.huggingface.co/v1` |
| BytePlus (ModelArk) | OpenAI-compatible | `ark.ap-southeast.bytepluses.com/api/v3` |
| Ollama | OpenAI-compatible | `127.0.0.1:11434/v1` |
| DeepSeek | OpenAI-compatible | Custom baseUrl |
| Any custom provider | Auto-detected | From `openclaw.json` |

---

## Project Structure

```
oc-inspector/
├── bin/
│   └── cli.mjs           # CLI entry point and subcommands
├── src/
│   ├── server.mjs         # HTTP server, API endpoints
│   ├── proxy.mjs          # Reverse proxy, request/response interception
│   ├── dashboard.mjs      # Embedded HTML/JS/CSS web dashboard
│   ├── config.mjs         # OpenClaw config read/patch/restore
│   ├── providers.mjs      # Provider registry and detection
│   ├── pricing.mjs        # Model pricing and cost calculation
│   ├── history.mjs        # Persistent daily usage storage
│   └── ws.mjs             # WebSocket server for real-time updates
├── package.json
└── README.md
```

---

## Requirements

- **Node.js** >= 18
- **OpenClaw** installed and configured (`~/.openclaw/openclaw.json`)

---

## License

MIT
