/**
 * Reverse proxy engine for the OpenClaw Inspector.
 *
 * Routes requests from `/{provider}/{path}` to upstream APIs, captures
 * request/response bodies, handles SSE streaming with event collection,
 * and maintains a circular buffer of entries for the dashboard.
 *
 * @module proxy
 */

import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { detectApiFamily } from "./providers.mjs";
import {
  parseGenericUsage,
  accumulateStreamUsage,
} from "./usage-parsers.mjs";
import { calculateCost } from "./pricing.mjs";
import { recordRequest } from "./history.mjs";

/** Maximum entries kept in the circular buffer. */
const MAX_ENTRIES = 500;

/** @type {Map<string, object>} Entry storage keyed by ID. */
const entries = new Map();

/** @type {string[]} Ordered list of entry IDs (oldest first). */
const entryOrder = [];

/**
 * Get all entries as an array (newest first).
 *
 * @returns {object[]}
 */
export function getAllEntries() {
  return entryOrder.map((id) => entries.get(id)).reverse();
}

/**
 * Get a single entry by ID.
 *
 * @param {string} id - Entry ID.
 * @returns {object|undefined}
 */
export function getEntry(id) {
  return entries.get(id);
}

/**
 * Clear all entries.
 */
export function clearEntries() {
  entries.clear();
  entryOrder.length = 0;
}

/**
 * Compute aggregate statistics across all captured entries.
 *
 * @returns {object} Stats including totals per provider, per model, and overall.
 */
export function getStats() {
  const byProvider = {};
  const byModel = {};
  let totalRequests = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalDuration = 0;
  let totalCost = 0;
  let errors = 0;

  for (const id of entryOrder) {
    const e = entries.get(id);
    if (!e) continue;
    totalRequests++;
    if (e.state === "error") errors++;
    if (e.duration) totalDuration += e.duration;
    const cost = e.cost || 0;
    totalCost += cost;

    const u = e.usage;
    if (!u) continue;
    const inp = u.inputTokens || 0;
    const out = u.outputTokens || 0;
    const cached = u.cachedTokens || 0;
    totalInputTokens += inp;
    totalOutputTokens += out;
    totalCachedTokens += cached;

    // Per provider
    const p = e.provider || "unknown";
    if (!byProvider[p]) byProvider[p] = { requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, errors: 0 };
    byProvider[p].requests++;
    byProvider[p].inputTokens += inp;
    byProvider[p].outputTokens += out;
    byProvider[p].cachedTokens += cached;
    byProvider[p].cost += cost;
    if (e.state === "error") byProvider[p].errors++;

    // Per model
    const m = u.model || e.reqModel || "?";
    if (m !== "?") {
      if (!byModel[m]) byModel[m] = { requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, provider: p };
      byModel[m].requests++;
      byModel[m].inputTokens += inp;
      byModel[m].outputTokens += out;
      byModel[m].cachedTokens += cached;
      byModel[m].cost += cost;
    }
  }

  // Recent entries (last 10) for live view
  const recentEntries = [];
  const recentIds = entryOrder.slice(-10).reverse();
  for (const id of recentIds) {
    const e = entries.get(id);
    if (!e) continue;
    const u = e.usage || {};
    recentEntries.push({
      id: e.id,
      provider: e.provider || "?",
      model: u.model || e.reqModel || "?",
      state: e.state,
      duration: e.duration || 0,
      totalTokens: (u.inputTokens || 0) + (u.outputTokens || 0),
      cost: e.cost || 0,
    });
  }

  return {
    totalRequests,
    totalInputTokens,
    totalOutputTokens,
    totalCachedTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    totalDuration,
    totalCost,
    errors,
    byProvider,
    byModel,
    recentEntries,
  };
}

/**
 * Store a new entry, evicting oldest if buffer is full.
 *
 * @param {object} entry
 */
function storeEntry(entry) {
  entries.set(entry.id, entry);
  entryOrder.push(entry.id);
  while (entryOrder.length > MAX_ENTRIES) {
    const oldest = entryOrder.shift();
    entries.delete(oldest);
  }
}

/** @type {Map<string, string>} Provider -> upstream base URL. */
let targetMap = new Map();

/** @type {((type: string, entry: object) => void)|null} Broadcast callback. */
let broadcastFn = null;

/**
 * Initialize the proxy with target URLs and a broadcast function.
 *
 * @param {Map<string, string>} targets - Provider -> upstream URL map.
 * @param {(type: string, entry: object) => void} broadcast - Callback for WebSocket broadcasts.
 */
export function initProxy(targets, broadcast) {
  targetMap = targets;
  broadcastFn = broadcast;
}

/**
 * Update the target map (e.g., after enable/disable).
 *
 * @param {Map<string, string>} targets
 */
export function updateTargets(targets) {
  targetMap = targets;
}

/**
 * Build a summary of an entry suitable for list view (no full bodies).
 *
 * @param {object} entry
 * @returns {object}
 */
function entrySummary(entry) {
  return {
    id: entry.id,
    provider: entry.provider,
    method: entry.method,
    path: entry.path,
    status: entry.status,
    state: entry.state,
    timestamp: entry.timestamp,
    duration: entry.duration,
    model: entry.usage?.model || entry.reqModel || "?",
    usage: entry.usage || null,
    cost: entry.cost || 0,
  };
}

/**
 * Forward headers from the incoming request, filtering out hop-by-hop headers.
 *
 * @param {object} incomingHeaders
 * @returns {object}
 */
function forwardHeaders(incomingHeaders) {
  const skip = new Set(["host", "connection", "transfer-encoding", "content-length", "keep-alive"]);
  const out = {};
  for (const [key, val] of Object.entries(incomingHeaders)) {
    if (!skip.has(key.toLowerCase())) {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Parse SSE text into individual data payloads.
 *
 * @param {string} text - Raw SSE text.
 * @returns {object[]} Array of parsed JSON objects from `data:` lines.
 */
function parseSSEEvents(text) {
  const events = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      // Skip unparseable lines
    }
  }
  return events;
}

/**
 * Handle an incoming proxy request.
 *
 * Extracts the provider from the URL path, forwards to the upstream API,
 * captures request/response bodies, extracts token usage, and broadcasts
 * events via WebSocket.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
export async function handleProxy(req, res) {
  // Parse provider from path: /anthropic/v1/messages -> provider="anthropic", rest="/v1/messages"
  const urlPath = req.url || "/";
  const slashIdx = urlPath.indexOf("/", 1);
  const provider = slashIdx > 0 ? urlPath.slice(1, slashIdx) : urlPath.slice(1);
  const rest = slashIdx > 0 ? urlPath.slice(slashIdx) : "/";

  const targetBase = targetMap.get(provider);
  if (!targetBase) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `Unknown provider: ${provider}` }));
    return;
  }

  // Read request body
  const reqChunks = [];
  for await (const chunk of req) reqChunks.push(chunk);
  const reqBody = Buffer.concat(reqChunks);

  // Parse request JSON (best effort)
  let reqJson = null;
  let reqModel = "?";
  try {
    reqJson = JSON.parse(reqBody.toString("utf-8"));
    reqModel = reqJson.model || "?";
  } catch {
    // Not JSON, fine
  }

  // Create entry
  const entry = {
    id: randomUUID(),
    provider,
    method: req.method,
    path: rest,
    status: null,
    state: "pending",
    timestamp: Date.now(),
    duration: null,
    reqHeaders: { ...req.headers },
    reqBody: reqJson || reqBody.toString("utf-8"),
    reqSize: reqBody.length,
    reqModel,
    resHeaders: null,
    resBody: null,
    resSize: 0,
    usage: null,
    error: null,
  };
  storeEntry(entry);
  broadcastFn?.("new", entrySummary(entry));

  // Build upstream URL — concatenate base path + rest to preserve base paths like /api/v3
  const targetUrl = new URL(targetBase.replace(/\/+$/, "") + rest);
  const isHttps = targetUrl.protocol === "https:";
  const transport = isHttps ? https : http;

  const fwdHeaders = forwardHeaders(req.headers);
  fwdHeaders["host"] = targetUrl.host;
  if (reqBody.length > 0) {
    fwdHeaders["content-length"] = String(reqBody.length);
  }

  const proxyReq = transport.request(
    targetUrl,
    {
      method: req.method,
      headers: fwdHeaders,
    },
    (proxyRes) => {
      const contentType = proxyRes.headers["content-type"] || "";
      const isSSE = contentType.includes("text/event-stream") || contentType.includes("stream");

      entry.status = proxyRes.statusCode;
      entry.resHeaders = { ...proxyRes.headers };

      // Forward status and headers to client
      res.writeHead(proxyRes.statusCode, proxyRes.headers);

      if (isSSE) {
        handleSSE(proxyRes, res, entry, provider);
      } else {
        handleBuffered(proxyRes, res, entry, provider);
      }
    }
  );

  proxyReq.on("error", (err) => {
    entry.state = "error";
    entry.error = err.message;
    entry.duration = Date.now() - entry.timestamp;
    broadcastFn?.("update", entrySummary(entry));

    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
  });

  proxyReq.write(reqBody);
  proxyReq.end();
}

/**
 * Handle a streaming (SSE) response: relay to client while collecting events.
 *
 * @param {http.IncomingMessage} proxyRes
 * @param {http.ServerResponse} res
 * @param {object} entry
 * @param {string} provider
 */
function handleSSE(proxyRes, res, entry, provider) {
  const chunks = [];
  let totalSize = 0;

  proxyRes.on("data", (chunk) => {
    chunks.push(chunk.toString("utf-8"));
    totalSize += chunk.length;
    res.write(chunk);
  });

  proxyRes.on("end", () => {
    res.end();

    const fullText = chunks.join("");
    const events = parseSSEEvents(fullText);
    const apiFamily = detectApiFamily(provider);

    entry.resBody = fullText;
    entry.resSize = totalSize;
    entry.duration = Date.now() - entry.timestamp;
    entry.state = "done";
    entry.sseEvents = events;
    entry.usage = accumulateStreamUsage(events, apiFamily === "anthropic" ? "anthropic" : "openai");
    entry.cost = calculateCost(entry.usage?.model || entry.reqModel, entry.usage);

    broadcastFn?.("update", entrySummary(entry));
    recordRequest(entry);
  });

  proxyRes.on("error", (err) => {
    entry.state = "error";
    entry.error = err.message;
    entry.duration = Date.now() - entry.timestamp;
    broadcastFn?.("update", entrySummary(entry));
    res.end();
  });
}

/**
 * Handle a non-streaming (buffered) response.
 *
 * @param {http.IncomingMessage} proxyRes
 * @param {http.ServerResponse} res
 * @param {object} entry
 * @param {string} provider
 */
function handleBuffered(proxyRes, res, entry, provider) {
  const chunks = [];

  proxyRes.on("data", (chunk) => {
    chunks.push(chunk);
    res.write(chunk);
  });

  proxyRes.on("end", () => {
    res.end();

    const body = Buffer.concat(chunks);
    entry.resSize = body.length;
    entry.duration = Date.now() - entry.timestamp;
    entry.state = "done";

    try {
      const json = JSON.parse(body.toString("utf-8"));
      entry.resBody = json;
      entry.usage = parseGenericUsage(json);
      entry.cost = calculateCost(entry.usage?.model || entry.reqModel, entry.usage);
    } catch {
      entry.resBody = body.toString("utf-8");
    }

    broadcastFn?.("update", entrySummary(entry));
    recordRequest(entry);
  });

  proxyRes.on("error", (err) => {
    entry.state = "error";
    entry.error = err.message;
    entry.duration = Date.now() - entry.timestamp;
    broadcastFn?.("update", entrySummary(entry));
    recordRequest(entry);
    res.end();
  });
}
