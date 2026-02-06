/**
 * Persistent daily usage history storage.
 *
 * Stores usage stats per day in JSON files under `~/.openclaw/.inspector-history/`.
 * Each file is named `YYYY-MM-DD.json` and contains per-model token/cost breakdown.
 *
 * @module history
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** @type {string|null} Directory for history files. */
let historyDir = null;

/** @type {object|null} In-memory cache of today's data. */
let todayCache = null;

/** @type {string|null} Today's date string (YYYY-MM-DD). */
let todayDate = null;

/**
 * Initialize the history module.
 *
 * @param {string} openclawDir - Path to ~/.openclaw directory.
 *
 * Example:
 *   >>> initHistory("/Users/nex/.openclaw");
 */
export function initHistory(openclawDir) {
  historyDir = join(openclawDir, ".inspector-history");
  mkdirSync(historyDir, { recursive: true });
  todayDate = getDateStr();
  todayCache = loadDay(todayDate);
}

/**
 * Record a completed request into today's history.
 *
 * @param {object} entry - Proxy entry with usage and cost data.
 * @param {string} entry.provider - Provider name.
 * @param {object} [entry.usage] - Token usage object.
 * @param {number} [entry.cost] - Calculated cost in USD.
 * @param {string} [entry.reqModel] - Requested model ID.
 * @param {number} [entry.duration] - Request duration in ms.
 * @param {string} [entry.state] - Entry state (done, error).
 */
export function recordRequest(entry) {
  if (!historyDir || !entry) return;

  // Roll over to new day if needed
  const now = getDateStr();
  if (now !== todayDate) {
    todayDate = now;
    todayCache = loadDay(todayDate);
  }

  const u = entry.usage || {};
  const model = u.model || entry.reqModel || "unknown";
  const provider = entry.provider || "unknown";
  const cost = entry.cost || 0;

  // Update totals
  todayCache.totalRequests++;
  todayCache.totalInputTokens += u.inputTokens || 0;
  todayCache.totalOutputTokens += u.outputTokens || 0;
  todayCache.totalCachedTokens += u.cachedTokens || 0;
  todayCache.totalCost += cost;
  if (entry.state === "error") todayCache.totalErrors++;

  // Update per-provider
  if (!todayCache.byProvider[provider]) {
    todayCache.byProvider[provider] = { requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, errors: 0 };
  }
  const prov = todayCache.byProvider[provider];
  prov.requests++;
  prov.inputTokens += u.inputTokens || 0;
  prov.outputTokens += u.outputTokens || 0;
  prov.cachedTokens += u.cachedTokens || 0;
  prov.cost += cost;
  if (entry.state === "error") prov.errors++;

  // Update per-model
  if (model !== "unknown" && model !== "?") {
    if (!todayCache.byModel[model]) {
      todayCache.byModel[model] = { requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, provider };
    }
    const m = todayCache.byModel[model];
    m.requests++;
    m.inputTokens += u.inputTokens || 0;
    m.outputTokens += u.outputTokens || 0;
    m.cachedTokens += u.cachedTokens || 0;
    m.cost += cost;
  }

  todayCache.lastUpdated = new Date().toISOString();

  // Persist to disk (debounced would be better but simple write is fine for now)
  saveDay(todayDate, todayCache);
}

/**
 * Get history for a specific date.
 *
 * @param {string} date - Date string (YYYY-MM-DD).
 * @returns {object|null} Day stats or null if not found.
 */
export function getDay(date) {
  if (!historyDir) return null;
  if (date === todayDate && todayCache) return todayCache;
  return loadDay(date);
}

/**
 * Get history for a range of recent days.
 *
 * @param {number} [days=7] - Number of days to look back.
 * @returns {object[]} Array of { date, ...stats } objects, newest first.
 *
 * Example:
 *   >>> getRecent(7)
 *   [{ date: "2026-02-06", totalRequests: 42, ... }, ...]
 */
export function getRecent(days = 7) {
  if (!historyDir) return [];

  const results = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = formatDate(d);
    const data = getDay(dateStr);
    if (data && data.totalRequests > 0) {
      results.push({ date: dateStr, ...data });
    }
  }
  return results;
}

/**
 * List all available history dates.
 *
 * @returns {string[]} Array of date strings (YYYY-MM-DD), newest first.
 */
export function listDates() {
  if (!historyDir || !existsSync(historyDir)) return [];
  return readdirSync(historyDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort()
    .reverse();
}

// ── Internal helpers ──

function getDateStr() {
  return formatDate(new Date());
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function emptyDay() {
  return {
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    totalCost: 0,
    totalErrors: 0,
    byProvider: {},
    byModel: {},
    lastUpdated: null,
  };
}

function loadDay(dateStr) {
  if (!historyDir) return emptyDay();
  const filePath = join(historyDir, `${dateStr}.json`);
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return emptyDay();
}

function saveDay(dateStr, data) {
  if (!historyDir) return;
  const filePath = join(historyDir, `${dateStr}.json`);
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch {
    // Non-critical — silently fail
  }
}
