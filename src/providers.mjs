/**
 * Provider registry for OpenClaw Inspector.
 *
 * Maps provider names to their upstream API base URLs and detects which
 * providers are active by reading OpenClaw auth-profiles and config.
 *
 * @module providers
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Well-known base URLs for built-in OpenClaw providers.
 *
 * Sourced from @mariozechner/pi-ai models.generated.js and OpenClaw config
 * defaults. Keys must match provider names used in openclaw.json and
 * auth-profiles.json.
 *
 * @type {Record<string, string>}
 */
export const BUILTIN_URLS = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  "google-vertex": "https://us-central1-aiplatform.googleapis.com/v1",
  "google-antigravity": "https://generativelanguage.googleapis.com/v1beta",
  "google-gemini-cli": "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  zai: "https://api.z.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  cerebras: "https://api.cerebras.ai/v1",
  huggingface: "https://api-inference.huggingface.co/v1",
  "github-copilot": "https://api.githubcopilot.com",
  minimax: "https://api.minimax.chat/v1",
  "minimax-cn": "https://api.minimax.chat/v1",
  byteplus: "https://ark.ap-southeast.bytepluses.com/api/v3",
  "amazon-bedrock": "https://bedrock-runtime.us-east-1.amazonaws.com",
  "kimi-coding": "https://api.moonshot.cn/v1",
};

/**
 * Detect the API type (Anthropic Messages vs OpenAI Completions) for a provider.
 *
 * Used to select the correct token usage parser.
 *
 * @param {string} providerName - The provider identifier.
 * @returns {"anthropic" | "openai" | "unknown"} The API family.
 */
export function detectApiFamily(providerName) {
  const anthropicLike = new Set([
    "anthropic",
    "minimax",
    "minimax-cn",
    "zai",
    "cloudflare-ai-gateway",
  ]);
  if (anthropicLike.has(providerName)) return "anthropic";

  const openaiLike = new Set([
    "openai",
    "groq",
    "mistral",
    "xai",
    "openrouter",
    "cerebras",
    "huggingface",
    "google",
    "google-vertex",
    "google-antigravity",
    "google-gemini-cli",
    "github-copilot",
  ]);
  if (openaiLike.has(providerName)) return "openai";

  return "unknown";
}

/**
 * Read auth-profiles.json from an OpenClaw agent directory and return the
 * set of provider names that have credentials configured.
 *
 * @param {string} openclawDir - Path to ~/.openclaw (or equivalent).
 * @returns {Set<string>} Provider names with active auth profiles.
 *
 * Example:
 *   >>> detectActiveProviders("/Users/me/.openclaw")
 *   Set { "anthropic", "byteplus" }
 */
export function detectActiveProviders(openclawDir) {
  const providers = new Set();

  // Check auth-profiles in main agent dir
  const profilePath = join(openclawDir, "agents", "main", "agent", "auth-profiles.json");
  if (existsSync(profilePath)) {
    try {
      const data = JSON.parse(readFileSync(profilePath, "utf-8"));
      const profiles = data.profiles || {};
      for (const key of Object.keys(profiles)) {
        // Keys are "provider:profile" e.g. "anthropic:default"
        const provider = key.split(":")[0];
        if (provider) providers.add(provider);
      }
    } catch {
      // Ignore parse errors
    }
  }

  return providers;
}

/**
 * Build the full provider-to-URL mapping for interception.
 *
 * Merges built-in providers (from auth-profiles) with custom providers
 * (from openclaw.json models.providers section).
 *
 * @param {string} openclawDir - Path to ~/.openclaw.
 * @param {Record<string, { baseUrl?: string }>} [configProviders={}]
 *   The `models.providers` object from openclaw.json.
 * @returns {Map<string, string>} provider name -> upstream base URL.
 *
 * Example:
 *   >>> buildTargetMap("/Users/me/.openclaw", { byteplus: { baseUrl: "https://ark..." } })
 *   Map { "anthropic" => "https://api.anthropic.com", "byteplus" => "https://ark..." }
 */
export function buildTargetMap(openclawDir, configProviders = {}, inspectorState = null) {
  const targets = new Map();

  // 0. If we have inspector state (interception already enabled), use originals
  if (inspectorState?.originals) {
    for (const [name, orig] of Object.entries(inspectorState.originals)) {
      targets.set(name, orig.baseUrl);
    }
    return targets;
  }

  // 1. Add built-in providers that have auth configured
  const active = detectActiveProviders(openclawDir);
  for (const name of active) {
    if (BUILTIN_URLS[name]) {
      targets.set(name, BUILTIN_URLS[name]);
    }
  }

  // 2. Add/override with custom providers from config
  for (const [name, cfg] of Object.entries(configProviders)) {
    if (cfg.baseUrl) {
      if (isProxyUrl(cfg.baseUrl)) {
        // Already pointing to a proxy — try to resolve real URL
        // Check if it's our own proxy pattern: http://127.0.0.1:PORT/provider
        if (BUILTIN_URLS[name]) {
          targets.set(name, BUILTIN_URLS[name]);
        }
        // Otherwise skip — we can't determine the real upstream
      } else {
        targets.set(name, cfg.baseUrl);
      }
    }
  }

  // 3. Always include ollama if it's on default port
  if (!targets.has("ollama")) {
    targets.set("ollama", "http://127.0.0.1:11434/v1");
  }

  return targets;
}

/**
 * Check if a URL looks like it's pointing to a local proxy (not a real upstream).
 *
 * @param {string} url
 * @returns {boolean}
 */
function isProxyUrl(url) {
  // Matches localhost or 127.0.0.1 on non-standard ports (not 11434 which is Ollama)
  const match = url.match(/^https?:\/\/(127\.0\.0\.1|localhost):(\d+)/);
  if (!match) return false;
  const port = parseInt(match[2], 10);
  // Ollama default port is not a proxy
  if (port === 11434) return false;
  return true;
}
