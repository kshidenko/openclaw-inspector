/**
 * Model pricing lookup for cost calculation.
 *
 * Prices are per 1M tokens (USD). Loaded from openclaw.json model definitions
 * and supplemented with hardcoded pricing for built-in providers (Anthropic, OpenAI).
 *
 * @module pricing
 */

/**
 * Hardcoded pricing for well-known models (per 1M tokens, USD).
 *
 * Source: official provider pricing pages as of 2026-02.
 *
 * @type {Record<string, {input: number, output: number, cacheRead: number, cacheWrite: number}>}
 */
const BUILTIN_PRICING = {
  // Anthropic
  "claude-opus-4-5-20250929": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5-20250929": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  "claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },
  "o3": { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  "o3-mini": { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },
  "o4-mini": { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
};

/** @type {Map<string, {input: number, output: number, cacheRead: number, cacheWrite: number}>} */
const pricingMap = new Map();

/**
 * Initialize pricing table from openclaw.json config and built-in defaults.
 *
 * @param {object} config - Parsed openclaw.json.
 *
 * Example:
 *   >>> initPricing(config);
 *   >>> calculateCost("claude-sonnet-4-5-20250929", { inputTokens: 1000, outputTokens: 500 });
 *   0.0105
 */
export function initPricing(config) {
  pricingMap.clear();

  // Load built-in pricing first
  for (const [model, cost] of Object.entries(BUILTIN_PRICING)) {
    pricingMap.set(model, cost);
  }

  // Override/add from config providers
  const providers = config?.models?.providers || {};
  for (const [, providerCfg] of Object.entries(providers)) {
    if (!Array.isArray(providerCfg.models)) continue;
    for (const model of providerCfg.models) {
      if (model.id && model.cost) {
        pricingMap.set(model.id, {
          input: model.cost.input || 0,
          output: model.cost.output || 0,
          cacheRead: model.cost.cacheRead || 0,
          cacheWrite: model.cost.cacheWrite || 0,
        });
      }
    }
  }
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
