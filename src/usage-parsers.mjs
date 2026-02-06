/**
 * Token usage extraction for different LLM API formats.
 *
 * Handles Anthropic Messages API (streaming and non-streaming),
 * OpenAI-compatible APIs (GPT, BytePlus, Ollama, Groq, etc.),
 * and a generic fallback that tries both conventions.
 *
 * @module usage-parsers
 */

/**
 * @typedef {object} UsageResult
 * @property {string} model - Model identifier from the response.
 * @property {number} inputTokens - Input/prompt token count.
 * @property {number} outputTokens - Output/completion token count.
 * @property {number} totalTokens - Total tokens (computed if not provided).
 * @property {number} cachedTokens - Cache-read input tokens.
 * @property {number} cacheCreatedTokens - Cache-write tokens.
 */

/**
 * Extract token usage from a non-streaming Anthropic Messages API response.
 *
 * @param {object} body - Parsed JSON response body.
 * @returns {UsageResult}
 *
 * Example:
 *   >>> parseAnthropicUsage({ model: "claude-sonnet-4-5", usage: { input_tokens: 100, output_tokens: 50 } })
 *   { model: "claude-sonnet-4-5", inputTokens: 100, outputTokens: 50, ... }
 */
export function parseAnthropicUsage(body) {
  const usage = body.usage || {};
  return {
    model: body.model || "?",
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    cachedTokens: usage.cache_read_input_tokens || 0,
    cacheCreatedTokens: usage.cache_creation_input_tokens || 0,
  };
}

/**
 * Accumulate token usage from Anthropic SSE events.
 *
 * Anthropic splits usage across multiple event types:
 *   - `message_start` contains `message.usage` with input token counts
 *   - `message_delta` contains `usage` with output token counts
 *
 * This function merges all events into a single UsageResult.
 *
 * @param {object[]} events - Array of parsed SSE JSON payloads.
 * @returns {UsageResult}
 *
 * Example:
 *   >>> accumulateAnthropicStreamUsage([
 *   ...   { type: "message_start", message: { model: "claude-sonnet-4-5", usage: { input_tokens: 500 } } },
 *   ...   { type: "message_delta", usage: { output_tokens: 200 } }
 *   ... ])
 *   { model: "claude-sonnet-4-5", inputTokens: 500, outputTokens: 200, totalTokens: 700, ... }
 */
export function accumulateAnthropicStreamUsage(events) {
  let model = "?";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let cacheCreatedTokens = 0;

  for (const evt of events) {
    if (evt.type === "message_start" && evt.message) {
      model = evt.message.model || model;
      const u = evt.message.usage || {};
      inputTokens = u.input_tokens || 0;
      cachedTokens = u.cache_read_input_tokens || 0;
      cacheCreatedTokens = u.cache_creation_input_tokens || 0;
    }

    if (evt.type === "message_delta") {
      const u = evt.usage || {};
      // output_tokens in message_delta is cumulative, take the latest
      if (u.output_tokens != null) outputTokens = u.output_tokens;
      // Some proxies also include input in delta, update if present
      if (u.input_tokens != null) inputTokens = u.input_tokens;
      if (u.cache_read_input_tokens != null) cachedTokens = u.cache_read_input_tokens;
      if (u.cache_creation_input_tokens != null) cacheCreatedTokens = u.cache_creation_input_tokens;
    }
  }

  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedTokens,
    cacheCreatedTokens,
  };
}

/**
 * Extract token usage from a non-streaming OpenAI-compatible response.
 *
 * Works for OpenAI, BytePlus, Ollama, Groq, Mistral, xAI, etc.
 *
 * @param {object} body - Parsed JSON response body.
 * @returns {UsageResult}
 */
export function parseOpenAIUsage(body) {
  const usage = body.usage || {};
  const inp = usage.prompt_tokens || usage.input_tokens || 0;
  const out = usage.completion_tokens || usage.output_tokens || 0;
  const total = usage.total_tokens || (inp + out);
  const cached =
    usage.prompt_tokens_details?.cached_tokens ||
    usage.input_tokens_details?.cached_tokens ||
    0;

  return {
    model: body.model || "?",
    inputTokens: inp,
    outputTokens: out,
    totalTokens: total,
    cachedTokens: cached,
    cacheCreatedTokens: 0,
  };
}

/**
 * Accumulate token usage from OpenAI-compatible SSE events.
 *
 * OpenAI sends usage in one of:
 *   - The final chunk's `usage` field
 *   - A dedicated usage event (newer API versions)
 *
 * @param {object[]} events - Array of parsed SSE JSON payloads.
 * @returns {UsageResult}
 */
export function accumulateOpenAIStreamUsage(events) {
  let model = "?";
  let result = null;

  for (const evt of events) {
    // Get model from first chunk
    if (evt.model && model === "?") model = evt.model;

    // Usage can appear in any chunk, take the last one with usage data
    if (evt.usage && typeof evt.usage === "object") {
      const u = evt.usage;
      result = {
        model: evt.model || model,
        inputTokens: u.prompt_tokens || u.input_tokens || 0,
        outputTokens: u.completion_tokens || u.output_tokens || 0,
        totalTokens: u.total_tokens || 0,
        cachedTokens:
          u.prompt_tokens_details?.cached_tokens ||
          u.input_tokens_details?.cached_tokens ||
          0,
        cacheCreatedTokens: 0,
      };
    }
  }

  if (result) {
    if (!result.totalTokens) result.totalTokens = result.inputTokens + result.outputTokens;
    return result;
  }

  return { model, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, cacheCreatedTokens: 0 };
}

/**
 * Generic usage parser — tries Anthropic fields first, then OpenAI.
 *
 * @param {object} body - Parsed JSON response body.
 * @returns {UsageResult}
 */
export function parseGenericUsage(body) {
  const usage = body.usage || {};

  // Detect Anthropic format (uses input_tokens/output_tokens at top level of usage)
  if ("input_tokens" in usage && !("prompt_tokens" in usage)) {
    return parseAnthropicUsage(body);
  }

  // Detect OpenAI format
  if ("prompt_tokens" in usage || "completion_tokens" in usage) {
    return parseOpenAIUsage(body);
  }

  // Fallback: try both field names
  const inp = usage.input_tokens || usage.prompt_tokens || 0;
  const out = usage.output_tokens || usage.completion_tokens || 0;
  return {
    model: body.model || "?",
    inputTokens: inp,
    outputTokens: out,
    totalTokens: usage.total_tokens || (inp + out),
    cachedTokens: usage.cache_read_input_tokens || usage.prompt_tokens_details?.cached_tokens || 0,
    cacheCreatedTokens: usage.cache_creation_input_tokens || 0,
  };
}

/**
 * Auto-detect API family from SSE events and accumulate usage.
 *
 * @param {object[]} events - Parsed SSE JSON payloads.
 * @param {string} [hint] - Optional hint: "anthropic" or "openai".
 * @returns {UsageResult}
 */
export function accumulateStreamUsage(events, hint) {
  if (!events || events.length === 0) {
    return { model: "?", inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, cacheCreatedTokens: 0 };
  }

  // Auto-detect from event shape
  const isAnthropic =
    hint === "anthropic" || events.some((e) => e.type === "message_start" || e.type === "message_delta");

  if (isAnthropic) {
    return accumulateAnthropicStreamUsage(events);
  }

  return accumulateOpenAIStreamUsage(events);
}
