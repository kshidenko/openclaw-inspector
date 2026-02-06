/**
 * WebSocket server for real-time dashboard communication.
 *
 * Manages connected clients, broadcasts new/updated entries, and handles
 * detail requests for full entry data.
 *
 * @module ws
 */

import { WebSocketServer } from "ws";
import { getAllEntries, getEntry } from "./proxy.mjs";

/** @type {Set<import("ws").WebSocket>} Connected WebSocket clients. */
const clients = new Set();

/** @type {WebSocketServer|null} */
let wss = null;

/**
 * Initialize the WebSocket server on an existing HTTP server.
 *
 * @param {import("http").Server} httpServer - The HTTP server to attach to.
 *
 * Example:
 *   >>> initWebSocket(httpServer);
 */
export function initWebSocket(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);

    // Send existing entries on connect
    const existing = getAllEntries();
    for (const entry of existing.reverse()) {
      sendTo(ws, { type: "init", entry: summarize(entry) });
    }
    sendTo(ws, { type: "ready", count: existing.length });

    // Handle messages from client
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleClientMessage(ws, msg);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });
}

/**
 * Broadcast an event to all connected WebSocket clients.
 *
 * @param {string} type - Event type: "new" or "update".
 * @param {object} entry - Entry summary object.
 */
export function broadcast(type, entry) {
  const msg = JSON.stringify({ type, entry });
  const dead = [];
  for (const ws of clients) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      } else {
        dead.push(ws);
      }
    } catch {
      dead.push(ws);
    }
  }
  for (const ws of dead) {
    clients.delete(ws);
  }
}

/**
 * Send a JSON message to a single client.
 *
 * @param {import("ws").WebSocket} ws
 * @param {object} data
 */
function sendTo(ws, data) {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch {
    clients.delete(ws);
  }
}

/**
 * Handle an incoming message from a WebSocket client.
 *
 * Supported actions:
 *   - `{ action: "detail", id: "..." }` — send full entry data
 *   - `{ action: "clear" }` — clear all entries
 *
 * @param {import("ws").WebSocket} ws
 * @param {object} msg
 */
function handleClientMessage(ws, msg) {
  if (msg.action === "detail" && msg.id) {
    const entry = getEntry(msg.id);
    if (entry) {
      sendTo(ws, { type: "detail", entry });
    }
  }
}

/**
 * Build an entry summary (no full bodies) for list display.
 *
 * @param {object} entry
 * @returns {object}
 */
function summarize(entry) {
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
  };
}

/**
 * Get the number of connected WebSocket clients.
 *
 * @returns {number}
 */
export function clientCount() {
  return clients.size;
}
