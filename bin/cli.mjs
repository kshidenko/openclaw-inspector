#!/usr/bin/env node

/**
 * CLI entry point for oc-inspector.
 *
 * Usage:
 *   npx oc-inspector [command] [options]
 *
 * Commands:
 *   start (default)   Start the inspector proxy + dashboard
 *   enable            Enable interception (patch OpenClaw config)
 *   disable           Disable interception (restore config)
 *   status            Show interception status
 *   stats             Show token usage statistics
 *   providers         List detected providers
 *
 * Options:
 *   --port <number>   Port for the inspector proxy (default: 18800)
 *   --open            Auto-open the dashboard in a browser
 *   --config <path>   Custom path to openclaw.json
 *   --json            Output as JSON (for stats/status)
 *   --help            Show help message
 */

const args = process.argv.slice(2);

/** Simple arg parser. */
function parseArgs(argv) {
  const opts = { command: "start", port: 18800, open: false, config: undefined, json: false, help: false };
  const commands = new Set(["start", "enable", "disable", "status", "stats", "providers"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (commands.has(arg) && i === 0) { opts.command = arg; continue; }
    if (arg === "--port" && argv[i + 1]) { opts.port = parseInt(argv[++i], 10); continue; }
    if (arg === "--open") { opts.open = true; continue; }
    if (arg === "--config" && argv[i + 1]) { opts.config = argv[++i]; continue; }
    if (arg === "--json") { opts.json = true; continue; }
    if (arg === "--help" || arg === "-h") { opts.help = true; continue; }
    // First non-flag arg is command
    if (!arg.startsWith("-") && !opts._cmdSet) { opts.command = arg; opts._cmdSet = true; }
  }
  return opts;
}

const opts = parseArgs(args);

if (opts.help) {
  console.log(`
  \x1b[38;5;208m🦞 oc-inspector\x1b[0m — Real-time API traffic inspector for OpenClaw

  \x1b[1mUsage:\x1b[0m
    npx oc-inspector [command] [options]

  \x1b[1mCommands:\x1b[0m
    start             Start the inspector proxy + dashboard (default)
    enable            Enable interception (patches OpenClaw config)
    disable           Disable interception (restores config)
    status            Show current interception status
    stats             Show token usage statistics from running inspector
    providers         List detected providers and target URLs

  \x1b[1mOptions:\x1b[0m
    --port <number>   Port for the inspector proxy (default: 18800)
    --open            Auto-open the dashboard in a browser
    --config <path>   Custom path to openclaw.json
    --json            Output as JSON (for stats, status, providers)
    --help, -h        Show this help message

  \x1b[1mExamples:\x1b[0m
    npx oc-inspector                   # Start inspector
    npx oc-inspector --open            # Start + open browser
    npx oc-inspector enable            # Enable interception
    npx oc-inspector disable           # Disable interception
    npx oc-inspector stats             # Show live token stats
    npx oc-inspector stats --json      # Stats as JSON
`);
  process.exit(0);
}

// ── Remote commands: talk to a running inspector ──
const remoteCommands = new Set(["stats", "providers"]);
if (remoteCommands.has(opts.command)) {
  await runRemoteCommand(opts);
  process.exit(0);
}

// ── Local commands: modify config directly ──
if (opts.command === "enable" || opts.command === "disable" || opts.command === "status") {
  await runLocalCommand(opts);
  process.exit(0);
}

// ── Start command ──
if (opts.command === "start") {
  await runStart(opts);
}

// ═══════════════════════════════════════════════════════════════
// Command implementations
// ═══════════════════════════════════════════════════════════════

async function runStart(opts) {
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

async function runLocalCommand(opts) {
  const { detect, readConfig, enable, disable, status } = await import("../src/config.mjs");
  const oc = detect(opts.config);

  if (!oc.exists) {
    console.error(`\x1b[31m  ✗ OpenClaw config not found at ${oc.configPath}\x1b[0m`);
    process.exit(1);
  }

  if (opts.command === "status") {
    const st = status(oc.dir);
    if (opts.json) {
      console.log(JSON.stringify(st, null, 2));
    } else {
      const dot = st.enabled ? "\x1b[32m●\x1b[0m" : "\x1b[90m●\x1b[0m";
      const label = st.enabled ? "\x1b[32menabled\x1b[0m" : "\x1b[90mdisabled\x1b[0m";
      console.log(`\n  ${dot} Interception: ${label}`);
      if (st.enabled) {
        console.log(`    Port: ${st.port}`);
        console.log(`    Providers: ${st.providers.join(", ")}`);
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
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

async function fetchApi(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch {
    console.error(`  \x1b[31m✗ Cannot connect to inspector at ${url}\x1b[0m`);
    console.error(`    Is the inspector running? Start with: npx oc-inspector`);
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

  // Totals
  console.log(`  \x1b[1mRequests:\x1b[0m    ${s.totalRequests}${s.errors > 0 ? `  (\x1b[31m${s.errors} errors\x1b[0m)` : ""}`);
  console.log(`  \x1b[1mTokens:\x1b[0m      ${fmtNum(s.totalTokens)} total  (in: ${fmtNum(s.totalInputTokens)}  out: ${fmtNum(s.totalOutputTokens)})`);
  if (s.totalCachedTokens > 0) {
    console.log(`  \x1b[1mCached:\x1b[0m      ${fmtNum(s.totalCachedTokens)}`);
  }
  if (s.totalDuration > 0) {
    const avgMs = Math.round(s.totalDuration / s.totalRequests);
    console.log(`  \x1b[1mAvg latency:\x1b[0m ${avgMs}ms`);
  }

  // By provider
  const providers = Object.entries(s.byProvider);
  if (providers.length > 0) {
    console.log("");
    console.log("  \x1b[1mBy Provider\x1b[0m");
    console.log("  " + "─".repeat(50));
    const maxTokens = Math.max(...providers.map(([, v]) => v.inputTokens + v.outputTokens));
    for (const [name, v] of providers.sort((a, b) => (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens))) {
      const total = v.inputTokens + v.outputTokens;
      console.log(`  \x1b[36m${name.padEnd(18)}\x1b[0m ${bar("", total, maxTokens)}  (${v.requests} reqs)`);
    }
  }

  // By model
  const models = Object.entries(s.byModel);
  if (models.length > 0) {
    console.log("");
    console.log("  \x1b[1mBy Model\x1b[0m");
    console.log("  " + "─".repeat(50));
    const maxTokens = Math.max(...models.map(([, v]) => v.inputTokens + v.outputTokens));
    for (const [name, v] of models.sort((a, b) => (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens))) {
      const total = v.inputTokens + v.outputTokens;
      const shortName = name.length > 28 ? name.slice(0, 27) + "…" : name;
      console.log(`  \x1b[33m${shortName.padEnd(30)}\x1b[0m ${bar("", total, maxTokens)}  (${v.requests} reqs)`);
    }
  }

  console.log("");
}
