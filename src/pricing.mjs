/**
 * Model pricing lookup for cost calculation.
 *
 * Pricing resolution order (highest priority first):
 *   1. User overrides from `~/.openclaw/.inspector.json` → `pricing` section
 *   2. Model costs from `openclaw.json` → `models.providers.*.models[].cost`
 *   3. Built-in hardcoded defaults (this file)
 *
 * Prices are per 1 M tokens (USD).
 *
 * @module pricing
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** @type {string|null} Path to the inspector config directory. */
let inspectorConfigDir = null;

/**
 * Hardcoded pricing for well-known models (per 1M tokens, USD).
 *
 * Source: official provider pricing pages as of 2026-02.
 *
 * @type {Record<string, {input: number, output: number, cacheRead: number, cacheWrite: number}>}
 */
const BUILTIN_PRICING = {
  // ── Anthropic (source: anthropic.com/pricing, Feb 2026) ──
  // Opus 4.6
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Opus 4.5
  "claude-opus-4-5-20251101": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // Sonnet 4.5
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Sonnet 4
  "claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-0": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Haiku 4.5
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Legacy Opus 4.1 / 4
  "claude-opus-4-1-20250805": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4-20250514": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4-0": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  // Legacy Haiku 3
  "claude-3-5-haiku-20241022": { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },

  // ── OpenAI (source: platform.openai.com/docs/pricing Standard tier, Feb 2026) ──
  // GPT-5 series
  "gpt-5.2": { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  "gpt-5.1": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },
  // GPT-4.1 series
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },
  // GPT-4o series
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  // Reasoning models
  "o3": { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  "o4-mini": { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
  "o3-mini": { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },
  "o1": { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 },
  "o1-mini": { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },

  // ── Google Gemini (common pricing) ──
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 0 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },

  // ── Groq (very cheap, free tier exists) ──
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79, cacheRead: 0, cacheWrite: 0 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08, cacheRead: 0, cacheWrite: 0 },

  // ── Mistral ──
  "mistral-large-latest": { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 },
  "mistral-small-latest": { input: 0.2, output: 0.6, cacheRead: 0, cacheWrite: 0 },

  // ── xAI ──
  "grok-3": { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
  "grok-3-mini": { input: 0.3, output: 0.5, cacheRead: 0, cacheWrite: 0 },

  // ── DeepSeek ──
  "deepseek-chat": { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
  "deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0 },
};

/** @type {Map<string, {input: number, output: number, cacheRead: number, cacheWrite: number}>} */
const pricingMap = new Map();

/**
 * Read the inspector-level config file (`~/.openclaw/.inspector.json`).
 *
 * @param {string} openclawDir - Path to ~/.openclaw.
 * @returns {object|null} Parsed config or null if not found.
 */
function readInspectorConfig(openclawDir) {
  if (!openclawDir) return null;
  const cfgPath = join(openclawDir, ".inspector.json");
  if (!existsSync(cfgPath)) return null;
  try {
    return JSON.parse(readFileSync(cfgPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Initialize pricing table.
 *
 * Resolution order (highest priority wins):
 *   1. `~/.openclaw/.inspector.json` → `pricing` map
 *   2. `openclaw.json` → per-model `cost` objects
 *   3. Built-in defaults in this file
 *
 * @param {object} config - Parsed openclaw.json.
 * @param {string} [openclawDir] - Path to ~/.openclaw (for loading .inspector.json).
 *
 * Example:
 *   >>> initPricing(config, "/Users/me/.openclaw");
 *   >>> calculateCost("claude-sonnet-4-5-20250929", { inputTokens: 1000, outputTokens: 500 });
 *   0.0105
 */
export function initPricing(config, openclawDir) {
  pricingMap.clear();
  inspectorConfigDir = openclawDir || null;

  // Layer 1: built-in defaults (lowest priority)
  for (const [model, cost] of Object.entries(BUILTIN_PRICING)) {
    pricingMap.set(model, cost);
  }

  // Layer 2: openclaw.json per-model cost overrides
  const providers = config?.models?.providers || {};
  for (const [, providerCfg] of Object.entries(providers)) {
    if (!Array.isArray(providerCfg.models)) continue;
    for (const model of providerCfg.models) {
      if (model.id && model.cost) {
        pricingMap.set(model.id, normalizeCost(model.cost));
      }
    }
  }

  // Layer 3: user overrides from .inspector.json (highest priority)
  const inspectorCfg = readInspectorConfig(openclawDir);
  if (inspectorCfg?.pricing) {
    for (const [model, cost] of Object.entries(inspectorCfg.pricing)) {
      pricingMap.set(model, normalizeCost(cost));
    }
    console.log(`[inspector] Loaded ${Object.keys(inspectorCfg.pricing).length} custom pricing entries from .inspector.json`);
  }
}

/**
 * Normalize a cost object to ensure all fields exist.
 *
 * @param {object} cost - Raw cost definition.
 * @returns {{ input: number, output: number, cacheRead: number, cacheWrite: number }}
 */
function normalizeCost(cost) {
  return {
    input: cost.input || 0,
    output: cost.output || 0,
    cacheRead: cost.cacheRead || 0,
    cacheWrite: cost.cacheWrite || 0,
  };
}

/**
 * Get the inspector config (from .inspector.json).
 *
 * @returns {object|null} Parsed config or null.
 */
export function getInspectorConfig() {
  return readInspectorConfig(inspectorConfigDir);
}

/**
 * Calculate cost for a request based on model and token usage.
 *
 * @param {string} modelId - Model identifier (e.g., "claude-sonnet-4-5-20250929").
 * @param {object} usage - Token usage object.
 * @param {number} [usage.inputTokens=0] - Input tokens.
 * @param {number} [usage.outputTokens=0] - Output tokens.
 * @param {number} [usage.cachedTokens=0] - Cache-read tokens.
 * @param {number} [usage.cacheCreatedTokens=0] - Cache-write tokens.
 * @returns {number} Cost in USD.
 *
 * Example:
 *   >>> calculateCost("claude-sonnet-4-5-20250929", { inputTokens: 10000, outputTokens: 500, cachedTokens: 5000 })
 *   0.0390
 */
export function calculateCost(modelId, usage) {
  if (!usage) return 0;

  // Try exact match first, then prefix match
  let pricing = pricingMap.get(modelId);
  if (!pricing) {
    for (const [key, val] of pricingMap) {
      if (modelId.startsWith(key) || key.startsWith(modelId)) {
        pricing = val;
        break;
      }
    }
  }
  if (!pricing) return 0;

  const inp = usage.inputTokens || 0;
  const out = usage.outputTokens || 0;
  const cacheRead = usage.cachedTokens || 0;
  const cacheWrite = usage.cacheCreatedTokens || 0;

  // Non-cached input = total input - cache read tokens
  const freshInput = Math.max(0, inp - cacheRead);

  return (
    (freshInput * pricing.input +
      out * pricing.output +
      cacheRead * pricing.cacheRead +
      cacheWrite * pricing.cacheWrite) /
    1_000_000
  );
}

/**
 * Get all known model pricing entries.
 *
 * @returns {Array<{model: string, input: number, output: number, cacheRead: number}>}
 */
export function getAllPricing() {
  return [...pricingMap.entries()].map(([model, cost]) => ({ model, ...cost }));
}
