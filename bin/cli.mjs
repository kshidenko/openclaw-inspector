#!/usr/bin/env node

/**
 * CLI entry point for @kshidenko/openclaw-inspector.
 *
 * Usage:
 *   npx @kshidenko/openclaw-inspector [options]
 *
 * Options:
 *   --port <number>   Port for the inspector proxy (default: 18800)
 *   --open            Auto-open the dashboard in a browser
 *   --config <path>   Custom path to openclaw.json
 *   --help            Show help message
 */

import { startServer } from "../src/server.mjs";

const args = process.argv.slice(2);

/** Parse a simple --key value or --flag argument list. */
function parseArgs(argv) {
  const opts = { port: 18800, open: false, config: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && argv[i + 1]) {
      opts.port = parseInt(argv[++i], 10);
    } else if (arg === "--open") {
      opts.open = true;
    } else if (arg === "--config" && argv[i + 1]) {
      opts.config = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    }
  }
  return opts;
}

const opts = parseArgs(args);

if (opts.help) {
  console.log(`
  oc-inspector — Real-time API traffic inspector for OpenClaw

  Usage:
    npx oc-inspector [options]

  Options:
    --port <number>   Port for the inspector proxy (default: 18800)
    --open            Auto-open the dashboard in a browser
    --config <path>   Custom path to openclaw.json
    --help, -h        Show this help message

  Once running, open http://localhost:<port> in your browser.
  Click "Enable" to start intercepting OpenClaw API traffic.
`);
  process.exit(0);
}

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

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n  Shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  process.exit(0);
});
