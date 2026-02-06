# oc-inspector

Real-time API traffic inspector for [OpenClaw](https://openclaw.ai). Intercepts LLM provider requests (Anthropic, OpenAI, BytePlus, Ollama, and more), shows token usage, costs, and message flow in a live web dashboard.

## Quick Start

```bash
npx oc-inspector
```

This starts the inspector proxy on port 18800 and opens a web dashboard.

## Features

- **One-click enable/disable** — patches OpenClaw config automatically, no manual editing
- **All providers** — Anthropic, OpenAI, BytePlus, Ollama, Groq, Mistral, xAI, OpenRouter, and any custom provider
- **Real-time dashboard** — WebSocket-powered live view of every API request and response
- **Token tracking** — accurate token counts for streaming (SSE) and non-streaming responses
- **Cost estimation** — per-request cost based on model pricing
- **Message inspector** — view system prompts, tool calls, thinking blocks, and full conversation history
- **Zero dependencies on OpenClaw internals** — works as a standalone reverse proxy

## Usage

```bash
# Start with defaults (port 18800)
npx oc-inspector

# Custom port
npx oc-inspector --port 9000

# Auto-open browser
npx oc-inspector --open

# Custom OpenClaw config path
npx oc-inspector --config /path/to/openclaw.json
```

## How It Works

1. The inspector starts an HTTP reverse proxy on `localhost:18800`
2. Click **Enable** in the web UI — it patches `openclaw.json` to route all providers through the proxy and restarts the gateway
3. All LLM API traffic flows through the inspector, which logs requests/responses and extracts token usage
4. Click **Disable** to restore the original config

## License

MIT
