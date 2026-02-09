/**
 * Main HTTP server for OpenClaw Inspector.
 *
 * Combines the reverse proxy, WebSocket server, dashboard, and API endpoints
 * into a single HTTP server instance.
 *
 * @module server
 */

import http from "node:http";
import { execSync } from "node:child_process";
import { renderDashboard } from "./dashboard.mjs";
import { initProxy, handleProxy, updateTargets, clearEntries, getStats } from "./proxy.mjs";
import { initWebSocket, broadcast } from "./ws.mjs";
import { detect, readConfig, enable, disable, status } from "./config.mjs";
import { buildTargetMap, BUILTIN_URLS } from "./providers.mjs";
import { initPricing, getAllPricing, getInspectorConfig } from "./pricing.mjs";
import { initHistory, getRecent, getDay, listDates } from "./history.mjs";

/**
 * Start the inspector server.
 *
 * @param {object} options
 * @param {number} options.port - Port to listen on (default 3000).
 * @param {string} [options.configPath] - Custom path to openclaw.json.
 * @param {boolean} [options.open] - Open browser on start.
 * @returns {Promise<{ server: http.Server, url: string, openclawDir: string }>}
 *
 * Example:
 *   >>> const { url } = await startServer({ port: 3000 });
 *   >>> console.log("Inspector at", url);
 */
export async function startServer({ port = 3000, host = "127.0.0.1", configPath, open = false }) {
  // Detect OpenClaw
  const oc = detect(configPath);
  if (!oc.exists) {
    console.error(`[inspector] OpenClaw config not found at ${oc.configPath}`);
    console.error(`[inspector] Use --config to specify the path`);
    process.exit(1);
  }

  // Build initial target map
  let config;
  try {
    config = readConfig(oc.configPath);
  } catch (err) {
    console.error(`[inspector] Failed to read config: ${err.message}`);
    process.exit(1);
  }

  // Check if interception was already enabled (from previous run)
  let inspectorState = null;
  try {
    const statePath = joinPath(oc.dir, ".inspector-state.json");
    if (existsFs(statePath)) {
      inspectorState = JSON.parse(readFs(statePath, "utf-8"));
    }
  } catch { /* ignore */ }

  const targets = buildTargetMap(oc.dir, config.models?.providers || {}, inspectorState);
  console.log(`[inspector] Detected providers: ${[...targets.keys()].join(", ")}`);

  // Initialize pricing and history
  initPricing(config, oc.dir);
  initHistory(oc.dir);

  // Initialize proxy
  initProxy(targets, broadcast);

  // Dashboard HTML
  const dashboardHtml = renderDashboard(port);

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";

    // Dashboard
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(dashboardHtml);
      return;
    }

    // API: status
    if (url === "/api/status" && req.method === "GET") {
      const st = status(oc.dir);
      jsonResponse(res, 200, { ...st, configPath: oc.configPath });
      return;
    }

    // API: enable
    if (url === "/api/enable" && req.method === "POST") {
      try {
        const result = enable({ configPath: oc.configPath, openclawDir: oc.dir, port });

        // Rebuild target map from state (use originals as the real URLs)
        refreshTargets(oc, port);

        jsonResponse(res, 200, result);
      } catch (err) {
        jsonResponse(res, 500, { ok: false, message: err.message });
      }
      return;
    }

    // API: disable
    if (url === "/api/disable" && req.method === "POST") {
      try {
        const result = disable({ configPath: oc.configPath, openclawDir: oc.dir });
        jsonResponse(res, 200, result);
      } catch (err) {
        jsonResponse(res, 500, { ok: false, message: err.message });
      }
      return;
    }

    // API: stats
    if (url === "/api/stats" && req.method === "GET") {
      jsonResponse(res, 200, getStats());
      return;
    }

    // API: history
    if (url.startsWith("/api/history") && req.method === "GET") {
      const parts = url.split("/");
      if (parts.length === 4 && parts[3]) {
        // /api/history/2026-02-06
        const date = parts[3].split("?")[0];
        const day = getDay(date);
        jsonResponse(res, 200, day ? { date, ...day } : { error: "No data for this date" });
      } else {
        // /api/history?days=N
        const params = new URL(url, "http://localhost").searchParams;
        const days = parseInt(params.get("days") || "30", 10);
        jsonResponse(res, 200, { days: getRecent(days), dates: listDates() });
      }
      return;
    }

    // API: pricing
    if (url === "/api/pricing" && req.method === "GET") {
      jsonResponse(res, 200, { models: getAllPricing() });
      return;
    }

    // API: inspector config
    if (url === "/api/config" && req.method === "GET") {
      const inspCfg = getInspectorConfig();
      jsonResponse(res, 200, { config: inspCfg, configPath: joinPath(oc.dir, ".inspector.json") });
      return;
    }

    // API: clear entries
    if (url === "/api/clear" && req.method === "POST") {
      clearEntries();
      jsonResponse(res, 200, { ok: true });
      return;
    }

    // API: providers (current target map)
    if (url === "/api/providers" && req.method === "GET") {
      const list = [];
      for (const [name, targetUrl] of targets) {
        list.push({ name, url: targetUrl });
      }
      jsonResponse(res, 200, { providers: list });
      return;
    }

    // Proxy: /{provider}/{path}
    const firstSlash = url.indexOf("/", 1);
    const providerName = firstSlash > 0 ? url.slice(1, firstSlash) : url.slice(1);
    if (targets.has(providerName)) {
      await handleProxy(req, res);
      return;
    }

    // 404
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  // Kill any existing process on the port before we try to listen
  try {
    const pids = execSync(`lsof -ti :${port}`, { stdio: "pipe" }).toString().trim();
    if (pids) {
      console.log(`[inspector] Port ${port} in use (PID ${pids.split("\n").join(", ")}) — killing...`);
      execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: "pipe" });
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch { /* no process on port — good */ }

  // Attach WebSocket
  initWebSocket(server);

  // Start listening
  await new Promise((resolve, reject) => {
    server.on("error", (err) => reject(err));
    server.listen(port, host, resolve);
  });

  const listenAddr = host === "0.0.0.0" ? "127.0.0.1" : host;
  const url = `http://${listenAddr}:${port}`;

  // Auto-open browser
  if (open) {
    const { exec } = await import("node:child_process");
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} ${url}`);
  }

  return { server, url, openclawDir: oc.dir };
}

/**
 * Refresh the proxy target map after enable/disable.
 *
 * After enabling, the config has proxy URLs — we need to use the ORIGINAL
 * upstream URLs from the inspector state file.
 *
 * @param {object} oc - OpenClaw detection result.
 * @param {number} port - Inspector port.
 */
import { readFileSync as readFs, existsSync as existsFs } from "node:fs";
import { join as joinPath } from "node:path";

function refreshTargets(oc, port) {
  try {
    const statePath = joinPath(oc.dir, ".inspector-state.json");

    if (existsFs(statePath)) {
      const state = JSON.parse(readFs(statePath, "utf-8"));
      const newTargets = new Map();
      for (const [name, orig] of Object.entries(state.originals || {})) {
        newTargets.set(name, orig.baseUrl);
      }
      updateTargets(newTargets);
      console.log(`[inspector] Targets refreshed: ${[...newTargets.keys()].join(", ")}`);
    }
  } catch {
    // Non-critical
  }
}

/**
 * Send a JSON response.
 *
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {object} data
 */
function jsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}
