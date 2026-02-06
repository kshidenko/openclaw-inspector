#!/usr/bin/env node

/**
 * CLI entry point for oc-inspector.
 *
 * Usage:
 *   npx oc-inspector [command] [options]
 *
 * Commands:
 *   start (default)   Start inspector as a background daemon
 *   stop              Stop the background daemon
 *   run               Start inspector in foreground (interactive)
 *   enable            Enable interception (patch OpenClaw config)
 *   disable           Disable interception (restore config)
 *   status            Show interception + daemon status
 *   stats             Show token usage statistics
 *   history           Show daily usage history
 *   providers         List detected providers
 *   pricing           Show model pricing table
 *   config            Show .inspector.json contents
 *   logs              Tail daemon log file
 *
 * Options:
 *   --port <number>   Port for the inspector proxy (default: 18800)
 *   --open            Auto-open the dashboard in a browser
 *   --config <path>   Custom path to openclaw.json
 *   --json            Output as JSON (for stats/status)
 *   --days <number>   Days for history command (default: 7)
 *   --help            Show help message
 */

import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, openSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

/** Inspector state directory for PID/log files. */
const INSPECTOR_DIR = join(homedir(), ".openclaw", ".inspector-runtime");

/** PID file path. */
const PID_FILE = join(INSPECTOR_DIR, "inspector.pid");

/** Log file path. */
const LOG_FILE = join(INSPECTOR_DIR, "inspector.log");

// ═══════════════════════════════════════════════════════════════
// Arg parser
// ═══════════════════════════════════════════════════════════════

/** Simple arg parser. */
function parseArgs(argv) {
  const opts = {
    command: "start",
    port: 18800,
    open: false,
    config: undefined,
    json: false,
    days: 7,
    lines: 50,
    help: false,
  };
  const commands = new Set([
    "start", "stop", "run", "restart",
    "enable", "disable", "status",
    "stats", "providers", "history", "pricing", "config",
    "logs", "help", "_serve",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (commands.has(arg) && i === 0) { opts.command = arg; continue; }
    if (arg === "--port" && argv[i + 1]) { opts.port = parseInt(argv[++i], 10); continue; }
    if (arg === "--open") { opts.open = true; continue; }
    if (arg === "--config" && argv[i + 1]) { opts.config = argv[++i]; continue; }
    if (arg === "--json") { opts.json = true; continue; }
    if (arg === "--days" && argv[i + 1]) { opts.days = parseInt(argv[++i], 10); continue; }
    if (arg === "--lines" && argv[i + 1]) { opts.lines = parseInt(argv[++i], 10); continue; }
    if (arg === "--help" || arg === "-h") { opts.help = true; continue; }
    if (!arg.startsWith("-") && !opts._cmdSet) { opts.command = arg; opts._cmdSet = true; }
  }
  return opts;
}

const opts = parseArgs(args);

// ═══════════════════════════════════════════════════════════════
// Help
// ═══════════════════════════════════════════════════════════════

if (opts.help) {
  console.log(`
  \x1b[38;5;208m🦞 oc-inspector\x1b[0m — Real-time API traffic inspector for OpenClaw

  \x1b[1mUsage:\x1b[0m
    npx oc-inspector [command] [options]

  \x1b[1mCommands:\x1b[0m
    start             Start inspector as a background daemon (default)
    stop              Stop the running daemon
    restart           Restart the daemon
    run               Start in foreground (interactive mode)
    enable            Enable interception (patches OpenClaw config)
    disable           Disable interception (restores config)
    status            Show daemon + interception status
    stats             Show token usage statistics
    history           Show daily usage history
    providers         List detected providers and target URLs
    pricing           Show model pricing table
    config            Show .inspector.json path and status
    logs              Show daemon log output

  \x1b[1mOptions:\x1b[0m
    --port <number>   Port for the inspector proxy (default: 18800)
    --open            Auto-open the dashboard in a browser
    --config <path>   Custom path to openclaw.json
    --json            Output as JSON (for stats, status, providers, history)
    --days <number>   Number of days to show in history (default: 7)
    --lines <number>  Number of log lines to show (default: 50)
    --help, -h        Show this help message

  \x1b[1mExamples:\x1b[0m
    npx oc-inspector                   # Start daemon (background)
    npx oc-inspector run               # Start foreground (interactive)
    npx oc-inspector stop              # Stop daemon
    npx oc-inspector restart           # Restart daemon
    npx oc-inspector enable            # Enable interception
    npx oc-inspector disable           # Disable interception
    npx oc-inspector stats             # Show live token stats
    npx oc-inspector stats --json      # Stats as JSON
    npx oc-inspector history --days 30 # Last 30 days
    npx oc-inspector pricing           # Show pricing table
    npx oc-inspector logs              # Show daemon logs
`);
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════
// Command routing
// ═══════════════════════════════════════════════════════════════

// help: show commands
if (opts.command === "help") {
  console.log("");
  console.log("  \x1b[38;5;208m🦞 oc-inspector\x1b[0m — Real-time API traffic inspector for OpenClaw");
  console.log("");
  printCommandsHelp();
  process.exit(0);
}

// Hidden: _serve is the actual foreground server (spawned by start)
if (opts.command === "_serve") {
  await runServe(opts);
}

// start: launch daemon
if (opts.command === "start") {
  await runDaemonStart(opts);
  process.exit(0);
}

// stop: kill daemon
if (opts.command === "stop") {
  runDaemonStop();
  process.exit(0);
}

// restart: stop + start
if (opts.command === "restart") {
  runDaemonStop(/* silent */ true);
  await new Promise((r) => setTimeout(r, 800));
  await runDaemonStart(opts);
  process.exit(0);
}

// run: foreground (interactive)
if (opts.command === "run") {
  await runForeground(opts);
}

// logs: show daemon log
if (opts.command === "logs") {
  runLogs(opts);
  process.exit(0);
}

// Remote commands: talk to a running inspector
const remoteCommands = new Set(["stats", "providers", "history", "pricing", "config"]);
if (remoteCommands.has(opts.command)) {
  await runRemoteCommand(opts);
  process.exit(0);
}

// Local commands: modify config directly
if (opts.command === "enable" || opts.command === "disable" || opts.command === "status") {
  await runLocalCommand(opts);
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════
// Daemon management
// ═══════════════════════════════════════════════════════════════

/**
 * Start the inspector as a detached background daemon.
 *
 * Spawns `_serve` command in a child process with stdout/stderr redirected
 * to a log file. Writes PID to disk for later stop/status.
 *
 * @param {object} opts - Parsed CLI options.
 */
async function runDaemonStart(opts) {
  // Check if already running
  const running = getDaemonStatus();
  if (running.alive) {
    console.log("");
    console.log("  \x1b[38;5;208m🦞 OpenClaw Inspector\x1b[0m");
    console.log("");
    console.log(`  \x1b[33m⚠\x1b[0m  Already running (PID ${running.pid})`);
    console.log(`  \x1b[32m✓\x1b[0m Dashboard:  http://127.0.0.1:${opts.port}`);
    console.log("");
    printCommandsHelp();
    return;
  }

  // Ensure runtime dir exists
  mkdirSync(INSPECTOR_DIR, { recursive: true });

  // Build child args
  const childArgs = ["_serve", "--port", String(opts.port)];
  if (opts.config) childArgs.push("--config", opts.config);
  if (opts.open) childArgs.push("--open");

  // Open log file descriptor for spawn stdio
  appendFileSync(LOG_FILE, `\n--- Inspector starting at ${new Date().toISOString()} ---\n`);
  const logFd = openSync(LOG_FILE, "a");

  // Spawn detached child process
  const child = spawn(process.execPath, [__filename, ...childArgs], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, OC_INSPECTOR_DAEMON: "1" },
  });

  // Write PID
  writeFileSync(PID_FILE, String(child.pid));
  child.unref();

  // Wait a moment and check if it started OK
  await new Promise((r) => setTimeout(r, 1500));

  const check = getDaemonStatus();

  console.log("");
  console.log("  \x1b[38;5;208m🦞 OpenClaw Inspector\x1b[0m");
  console.log("");

  if (check.alive) {
    console.log(`  \x1b[32m✓\x1b[0m Started in background (PID ${child.pid})`);
    console.log(`  \x1b[32m✓\x1b[0m Dashboard:  http://127.0.0.1:${opts.port}`);
    console.log(`  \x1b[32m✓\x1b[0m Log file:   ${LOG_FILE}`);
    console.log("");
    printCommandsHelp();
  } else {
    console.log(`  \x1b[31m✗ Failed to start — check logs:\x1b[0m`);
    console.log(`    ${LOG_FILE}`);
    console.log("");
    // Show last few lines of log
    try {
      const log = readFileSync(LOG_FILE, "utf-8");
      const lines = log.trim().split("\n").slice(-10);
      for (const l of lines) console.log(`    ${l}`);
      console.log("");
    } catch { /* ignore */ }
  }
}

/**
 * Stop the running daemon process.
 *
 * @param {boolean} [silent=false] - Suppress output (used by restart).
 */
function runDaemonStop(silent = false) {
  const st = getDaemonStatus();

  if (!st.pid) {
    if (!silent) {
      console.log("");
      console.log("  \x1b[90m● Inspector is not running (no PID file)\x1b[0m");
      console.log("");
    }
    return;
  }

  if (st.alive) {
    try {
      process.kill(st.pid, "SIGTERM");
      if (!silent) {
        console.log("");
        console.log(`  \x1b[32m✓\x1b[0m Stopped inspector (PID ${st.pid})`);
        console.log("");
      }
    } catch (err) {
      if (!silent) {
        console.log("");
        console.log(`  \x1b[31m✗ Failed to stop PID ${st.pid}: ${err.message}\x1b[0m`);
        console.log("");
      }
    }
  } else {
    if (!silent) {
      console.log("");
      console.log(`  \x1b[90m● Inspector was not running (stale PID ${st.pid})\x1b[0m`);
      console.log("");
    }
  }

  // Clean up PID file
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}

/**
 * Check if the daemon process is alive.
 *
 * @returns {{ pid: number|null, alive: boolean }}
 */
function getDaemonStatus() {
  if (!existsSync(PID_FILE)) return { pid: null, alive: false };
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid)) return { pid: null, alive: false };
    // Signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return { pid, alive: true };
  } catch (err) {
    if (err.code === "ESRCH") {
      // Process doesn't exist
      return { pid: null, alive: false };
    }
    if (err.code === "EPERM") {
      // Process exists but we can't signal it (still alive)
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
      return { pid, alive: true };
    }
    return { pid: null, alive: false };
  }
}

/**
 * Show the last N lines of the daemon log file.
 *
 * @param {object} opts - Parsed CLI options.
 */
function runLogs(opts) {
  if (!existsSync(LOG_FILE)) {
    console.log("\n  \x1b[90mNo log file found. Start the daemon first: oc-inspector start\x1b[0m\n");
    return;
  }
  try {
    const content = readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n");
    const tail = lines.slice(-opts.lines);
    console.log("");
    console.log(`  \x1b[38;5;208m🦞 Inspector Logs\x1b[0m  \x1b[90m(last ${tail.length} lines)\x1b[0m`);
    console.log("  " + "─".repeat(56));
    for (const l of tail) {
      console.log(`  ${l}`);
    }
    console.log("  " + "─".repeat(56));
    console.log(`  \x1b[90m${LOG_FILE}\x1b[0m`);
    console.log("");
  } catch (err) {
    console.error(`  \x1b[31m✗ Cannot read log: ${err.message}\x1b[0m`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Foreground / Serve
// ═══════════════════════════════════════════════════════════════

/**
 * Hidden `_serve` command — runs the server in current process.
 * Called by the daemon spawn or can be used directly.
 *
 * @param {object} opts - Parsed CLI options.
 */
async function runServe(opts) {
  const { startServer } = await import("../src/server.mjs");

  console.log("");
  console.log("  \x1b[38;5;208m🦞 OpenClaw Inspector\x1b[0m");
  console.log("");

  try {
    const { url, openclawDir } = await startServer({
      port: opts.port,
      configPath: opts.config,
      open: opts.open,
    });

    console.log(`  \x1b[32m✓\x1b[0m Dashboard:  ${url}`);
    console.log(`  \x1b[32m✓\x1b[0m Config:     ${openclawDir}/openclaw.json`);
    console.log(`  \x1b[32m✓\x1b[0m Proxy port: ${opts.port}`);
    console.log(`  \x1b[32m✓\x1b[0m PID:        ${process.pid}`);
    console.log("");
  } catch (err) {
    console.error(`\x1b[31m  ✗ Failed to start: ${err.message}\x1b[0m`);
    process.exit(1);
  }

  process.on("SIGINT", () => { console.log("\n  Shutting down..."); process.exit(0); });
  process.on("SIGTERM", () => { console.log("\n  Shutting down (SIGTERM)..."); process.exit(0); });
}

/**
 * Interactive foreground mode — same as `_serve` but with "Press Ctrl+C" prompt.
 *
 * @param {object} opts - Parsed CLI options.
 */
async function runForeground(opts) {
  const { startServer } = await import("../src/server.mjs");

  console.log("");
  console.log("  \x1b[38;5;208m🦞 OpenClaw Inspector\x1b[0m  \x1b[90m(foreground)\x1b[0m");
  console.log("");

  try {
    const { url, openclawDir } = await startServer({
      port: opts.port,
      configPath: opts.config,
      open: opts.open,
    });

    console.log(`  \x1b[32m✓\x1b[0m Dashboard:  ${url}`);
    console.log(`  \x1b[32m✓\x1b[0m Config:     ${openclawDir}/openclaw.json`);
    console.log(`  \x1b[32m✓\x1b[0m Proxy port: ${opts.port}`);
    console.log("");
    console.log("  Press \x1b[1mCtrl+C\x1b[0m to stop");
    console.log("");
  } catch (err) {
    console.error(`\x1b[31m  ✗ Failed to start: ${err.message}\x1b[0m`);
    process.exit(1);
  }

  process.on("SIGINT", () => { console.log("\n  Shutting down..."); process.exit(0); });
  process.on("SIGTERM", () => process.exit(0));
}

// ═══════════════════════════════════════════════════════════════
// Local commands (enable / disable / status)
// ═══════════════════════════════════════════════════════════════

async function runLocalCommand(opts) {
  const { detect, readConfig, enable, disable, status } = await import("../src/config.mjs");
  const oc = detect(opts.config);

  if (!oc.exists) {
    console.error(`\x1b[31m  ✗ OpenClaw config not found at ${oc.configPath}\x1b[0m`);
    process.exit(1);
  }

  if (opts.command === "status") {
    const st = status(oc.dir);
    const daemon = getDaemonStatus();

    if (opts.json) {
      console.log(JSON.stringify({ ...st, daemon }, null, 2));
    } else {
      // Daemon status
      const dDot = daemon.alive ? "\x1b[32m●\x1b[0m" : "\x1b[90m●\x1b[0m";
      const dLabel = daemon.alive ? `\x1b[32mrunning\x1b[0m (PID ${daemon.pid})` : "\x1b[90mstopped\x1b[0m";
      console.log(`\n  ${dDot} Daemon:       ${dLabel}`);

      // Interception status
      const iDot = st.enabled ? "\x1b[32m●\x1b[0m" : "\x1b[90m●\x1b[0m";
      const iLabel = st.enabled ? "\x1b[32menabled\x1b[0m" : "\x1b[90mdisabled\x1b[0m";
      console.log(`  ${iDot} Interception: ${iLabel}`);
      if (st.enabled) {
        console.log(`    Port: ${st.port}`);
        console.log(`    Providers: ${st.providers.join(", ")}`);
      }

      if (daemon.alive) {
        console.log(`\n  \x1b[90mDashboard: http://127.0.0.1:${st.port || opts.port}\x1b[0m`);
      }
      console.log("");
    }
    return;
  }

  if (opts.command === "enable") {
    console.log("  Enabling interception...");
    const result = enable({ configPath: oc.configPath, openclawDir: oc.dir, port: opts.port });
    if (result.ok) {
      console.log(`  \x1b[32m✓\x1b[0m ${result.message}`);
      console.log(`    Providers: ${result.providers.join(", ")}`);
    } else {
      console.error(`  \x1b[31m✗ ${result.message}\x1b[0m`);
    }
    return;
  }

  if (opts.command === "disable") {
    console.log("  Disabling interception...");
    const result = disable({ configPath: oc.configPath, openclawDir: oc.dir });
    if (result.ok) {
      console.log(`  \x1b[32m✓\x1b[0m ${result.message}`);
    } else {
      console.error(`  \x1b[31m✗ ${result.message}\x1b[0m`);
    }
    return;
  }
}

// ═══════════════════════════════════════════════════════════════
// Remote commands (talk to running inspector)
// ═══════════════════════════════════════════════════════════════

async function runRemoteCommand(opts) {
  const base = `http://127.0.0.1:${opts.port}`;

  if (opts.command === "stats") {
    const data = await fetchApi(`${base}/api/stats`);
    if (!data) return;
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
    printStats(data);
    return;
  }

  if (opts.command === "providers") {
    const data = await fetchApi(`${base}/api/providers`);
    if (!data) return;
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
    console.log(`\n  \x1b[1mActive Providers\x1b[0m\n`);
    for (const p of data.providers) {
      console.log(`    \x1b[36m${p.name.padEnd(20)}\x1b[0m ${p.url}`);
    }
    console.log("");
    return;
  }

  if (opts.command === "history") {
    const data = await fetchApi(`${base}/api/history?days=${opts.days}`);
    if (!data) return;
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
    printHistory(data.days || []);
    return;
  }

  if (opts.command === "pricing") {
    const data = await fetchApi(`${base}/api/pricing`);
    if (!data) return;
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
    printPricing(data.models || []);
    return;
  }

  if (opts.command === "config") {
    const data = await fetchApi(`${base}/api/config`);
    if (!data) return;
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }
    printConfig(data);
    return;
  }
}

// ═══════════════════════════════════════════════════════════════
// Helpers / Printers
// ═══════════════════════════════════════════════════════════════

/**
 * Print a compact command reference table.
 * Shown after successful daemon start and via `help` command.
 */
function printCommandsHelp() {
  const C = "\x1b[36m";   // cyan
  const D = "\x1b[90m";   // dim
  const R = "\x1b[0m";    // reset
  const B = "\x1b[1m";    // bold

  console.log(`  ${B}Commands:${R}`);
  console.log(`    ${C}oc-inspector${R}              Start daemon ${D}(default)${R}`);
  console.log(`    ${C}oc-inspector stop${R}          Stop daemon`);
  console.log(`    ${C}oc-inspector restart${R}       Restart daemon`);
  console.log(`    ${C}oc-inspector run${R}           Foreground mode ${D}(interactive)${R}`);
  console.log(`    ${C}oc-inspector status${R}        Daemon + interception status`);
  console.log(`    ${C}oc-inspector enable${R}        Enable interception`);
  console.log(`    ${C}oc-inspector disable${R}       Disable interception`);
  console.log(`    ${C}oc-inspector stats${R}         Live token/cost statistics`);
  console.log(`    ${C}oc-inspector history${R}       Daily usage history`);
  console.log(`    ${C}oc-inspector pricing${R}       Model pricing table`);
  console.log(`    ${C}oc-inspector providers${R}     Active providers list`);
  console.log(`    ${C}oc-inspector config${R}        Inspector config info`);
  console.log(`    ${C}oc-inspector logs${R}          Daemon log output`);
  console.log(`    ${C}oc-inspector help${R}          Show this help`);
  console.log("");
  console.log(`  ${D}Use --json for machine-readable output. See oc-inspector --help for all options.${R}`);
  console.log("");
}

async function fetchApi(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch {
    console.error(`  \x1b[31m✗ Cannot connect to inspector at ${url}\x1b[0m`);
    console.error(`    Is the inspector running? Start with: oc-inspector start`);
    return null;
  }
}

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function printStats(s) {
  const bar = (label, val, max, width = 24) => {
    const pct = max > 0 ? Math.min(val / max, 1) : 0;
    const filled = Math.round(pct * width);
    const empty = width - filled;
    return `${label}  ${"█".repeat(filled)}${"░".repeat(empty)}  ${fmtNum(val)}`;
  };

  console.log("");
  console.log("  \x1b[38;5;208m🦞 OpenClaw Inspector — Stats\x1b[0m");
  console.log("  " + "─".repeat(50));
  console.log("");

  console.log(`  \x1b[1mRequests:\x1b[0m    ${s.totalRequests}${s.errors > 0 ? `  (\x1b[31m${s.errors} errors\x1b[0m)` : ""}`);
  console.log(`  \x1b[1mTokens:\x1b[0m      ${fmtNum(s.totalTokens)} total  (in: ${fmtNum(s.totalInputTokens)}  out: ${fmtNum(s.totalOutputTokens)})`);
  if (s.totalCachedTokens > 0) {
    console.log(`  \x1b[1mCached:\x1b[0m      ${fmtNum(s.totalCachedTokens)}`);
  }
  console.log(`  \x1b[1mCost:\x1b[0m        \x1b[32m$${(s.totalCost || 0).toFixed(4)}\x1b[0m`);
  if (s.totalDuration > 0) {
    const avgMs = Math.round(s.totalDuration / s.totalRequests);
    console.log(`  \x1b[1mAvg latency:\x1b[0m ${avgMs}ms`);
  }

  const providers = Object.entries(s.byProvider);
  if (providers.length > 0) {
    console.log("");
    console.log("  \x1b[1mBy Provider\x1b[0m");
    console.log("  " + "─".repeat(50));
    const maxTokens = Math.max(...providers.map(([, v]) => v.inputTokens + v.outputTokens));
    for (const [name, v] of providers.sort((a, b) => (b[1].cost || 0) - (a[1].cost || 0) || (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens))) {
      const total = v.inputTokens + v.outputTokens;
      const costStr = v.cost > 0 ? `  \x1b[32m$${v.cost.toFixed(4)}\x1b[0m` : "";
      console.log(`  \x1b[36m${name.padEnd(18)}\x1b[0m ${bar("", total, maxTokens)}  (${v.requests} reqs)${costStr}`);
    }
  }

  const models = Object.entries(s.byModel);
  if (models.length > 0) {
    console.log("");
    console.log("  \x1b[1mBy Model\x1b[0m");
    console.log("  " + "─".repeat(50));
    const maxTokens = Math.max(...models.map(([, v]) => v.inputTokens + v.outputTokens));
    for (const [name, v] of models.sort((a, b) => (b[1].cost || 0) - (a[1].cost || 0) || (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens))) {
      const total = v.inputTokens + v.outputTokens;
      const shortName = name.length > 28 ? name.slice(0, 27) + "…" : name;
      const costStr = v.cost > 0 ? `  \x1b[32m$${v.cost.toFixed(4)}\x1b[0m` : "";
      console.log(`  \x1b[33m${shortName.padEnd(30)}\x1b[0m ${bar("", total, maxTokens)}  (${v.requests} reqs)${costStr}`);
    }
  }

  console.log("");
}

function printPricing(models) {
  console.log("");
  console.log("  \x1b[38;5;208m🦞 OpenClaw Inspector — Pricing\x1b[0m");
  console.log("  " + "═".repeat(76));
  console.log("");
  console.log(`  \x1b[1m${"Model".padEnd(36)}  ${"Input".padStart(8)}  ${"Output".padStart(8)}  ${"Cache R".padStart(8)}  ${"Cache W".padStart(8)}\x1b[0m`);
  console.log("  " + "─".repeat(76));

  const sorted = [...models].sort((a, b) => a.model.localeCompare(b.model));
  let lastPrefix = "";
  for (const m of sorted) {
    const prefix = m.model.split("-")[0];
    if (prefix !== lastPrefix && lastPrefix !== "") {
      console.log("  " + "·".repeat(76));
    }
    lastPrefix = prefix;

    const name = m.model.length > 34 ? m.model.slice(0, 33) + "…" : m.model;
    const inp = m.input > 0 ? ("$" + m.input.toFixed(2)).padStart(8) : "\x1b[90m     —  \x1b[0m";
    const out = m.output > 0 ? ("$" + m.output.toFixed(2)).padStart(8) : "\x1b[90m     —  \x1b[0m";
    const cr = m.cacheRead > 0 ? ("$" + m.cacheRead.toFixed(2)).padStart(8) : "\x1b[90m     —  \x1b[0m";
    const cw = m.cacheWrite > 0 ? ("$" + m.cacheWrite.toFixed(2)).padStart(8) : "\x1b[90m     —  \x1b[0m";
    console.log(`  \x1b[33m${name.padEnd(36)}\x1b[0m  ${inp}  ${out}  ${cr}  ${cw}`);
  }

  console.log("");
  console.log(`  \x1b[90mPrices are per 1M tokens (USD). Override in ~/.openclaw/.inspector.json\x1b[0m`);
  console.log("");
}

function printConfig(data) {
  console.log("");
  console.log("  \x1b[38;5;208m🦞 OpenClaw Inspector — Config\x1b[0m");
  console.log("  " + "═".repeat(56));
  console.log("");
  console.log(`  \x1b[1mConfig file:\x1b[0m  ${data.configPath}`);
  console.log(`  \x1b[1mExists:\x1b[0m       ${data.config ? "\x1b[32myes\x1b[0m" : "\x1b[90mno (using defaults)\x1b[0m"}`);

  if (data.config) {
    if (data.config.pricing) {
      const count = Object.keys(data.config.pricing).length;
      console.log(`  \x1b[1mPricing:\x1b[0m      ${count} custom model(s)`);
      for (const [model, cost] of Object.entries(data.config.pricing)) {
        const shortName = model.length > 30 ? model.slice(0, 29) + "…" : model;
        console.log(`    \x1b[33m${shortName.padEnd(32)}\x1b[0m in=$${cost.input || 0}  out=$${cost.output || 0}  cache=$${cost.cacheRead || 0}`);
      }
    }
    const otherKeys = Object.keys(data.config).filter(k => k !== "pricing");
    if (otherKeys.length > 0) {
      console.log(`  \x1b[1mOther keys:\x1b[0m   ${otherKeys.join(", ")}`);
    }
  } else {
    console.log("");
    console.log("  \x1b[90mTo create a config file, create:\x1b[0m");
    console.log(`    \x1b[36m${data.configPath}\x1b[0m`);
  }
  console.log("");
}

function printHistory(days) {
  console.log("");
  console.log("  \x1b[38;5;208m🦞 OpenClaw Inspector — History\x1b[0m");
  console.log("  " + "═".repeat(64));

  if (!days.length) {
    console.log("\n  \x1b[90mNo history data yet.\x1b[0m\n");
    return;
  }

  console.log("");
  console.log("  \x1b[1m  Date          Reqs    Input      Output     Cached     Cost\x1b[0m");
  console.log("  " + "─".repeat(64));

  let grandReqs = 0, grandIn = 0, grandOut = 0, grandCached = 0, grandCost = 0;

  for (const d of days) {
    const reqs = String(d.totalRequests).padStart(5);
    const inp = fmtNum(d.totalInputTokens).padStart(8);
    const out = fmtNum(d.totalOutputTokens).padStart(8);
    const cached = fmtNum(d.totalCachedTokens).padStart(8);
    const cost = ("$" + (d.totalCost || 0).toFixed(4)).padStart(9);
    const isToday = d.date === new Date().toISOString().slice(0, 10);
    const dateStr = isToday ? `\x1b[1m${d.date}\x1b[0m \x1b[33m⬤\x1b[0m` : `${d.date}  `;
    console.log(`  ${dateStr} ${reqs}  ${inp}  ${out}  ${cached}  \x1b[32m${cost}\x1b[0m`);

    grandReqs += d.totalRequests;
    grandIn += d.totalInputTokens;
    grandOut += d.totalOutputTokens;
    grandCached += d.totalCachedTokens;
    grandCost += d.totalCost || 0;
  }

  console.log("  " + "─".repeat(64));
  const tReqs = String(grandReqs).padStart(5);
  const tIn = fmtNum(grandIn).padStart(8);
  const tOut = fmtNum(grandOut).padStart(8);
  const tCached = fmtNum(grandCached).padStart(8);
  const tCost = ("$" + grandCost.toFixed(4)).padStart(9);
  console.log(`  \x1b[1m  TOTAL        ${tReqs}  ${tIn}  ${tOut}  ${tCached}  \x1b[32m${tCost}\x1b[0m\x1b[0m`);

  const modelTotals = {};
  for (const d of days) {
    for (const [name, v] of Object.entries(d.byModel || {})) {
      if (!modelTotals[name]) modelTotals[name] = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0, provider: v.provider };
      modelTotals[name].requests += v.requests;
      modelTotals[name].inputTokens += v.inputTokens;
      modelTotals[name].outputTokens += v.outputTokens;
      modelTotals[name].cost += v.cost || 0;
    }
  }
  const models = Object.entries(modelTotals);
  if (models.length > 0) {
    console.log("");
    console.log("  \x1b[1mModel Totals (all days)\x1b[0m");
    console.log("  " + "─".repeat(64));
    const maxCost = Math.max(...models.map(([, v]) => v.cost));
    for (const [name, v] of models.sort((a, b) => b[1].cost - a[1].cost)) {
      const shortName = name.length > 28 ? name.slice(0, 27) + "…" : name;
      const pct = maxCost > 0 ? Math.min(v.cost / maxCost, 1) : 0;
      const filled = Math.round(pct * 16);
      const empty = 16 - filled;
      const bar = "█".repeat(filled) + "░".repeat(empty);
      const costStr = v.cost > 0 ? `$${v.cost.toFixed(4)}` : "$0";
      console.log(`  \x1b[33m${shortName.padEnd(30)}\x1b[0m ${bar}  \x1b[32m${costStr.padStart(9)}\x1b[0m  (${v.requests} reqs)`);
    }
  }

  console.log("");
}
