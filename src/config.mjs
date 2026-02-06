/**
 * OpenClaw config manager for the Inspector.
 *
 * Handles detection of the OpenClaw installation, reading/patching/restoring
 * openclaw.json to route provider traffic through the inspector proxy,
 * and restarting the gateway.
 *
 * @module config
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { BUILTIN_URLS, detectActiveProviders } from "./providers.mjs";

/** Default OpenClaw state directory. */
const DEFAULT_OPENCLAW_DIR = join(homedir(), ".openclaw");

/** Filename for the main config. */
const CONFIG_FILENAME = "openclaw.json";

/** Filename for the inspector state (stores original URLs for restore). */
const STATE_FILENAME = ".inspector-state.json";

/**
 * Detect the OpenClaw directory and config file path.
 *
 * @param {string} [customPath] - Optional explicit path to openclaw.json.
 * @returns {{ dir: string, configPath: string, exists: boolean }}
 *
 * Example:
 *   >>> detect()
 *   { dir: "/Users/me/.openclaw", configPath: "/Users/me/.openclaw/openclaw.json", exists: true }
 */
export function detect(customPath) {
  if (customPath) {
    const dir = customPath.endsWith(CONFIG_FILENAME)
      ? customPath.slice(0, -CONFIG_FILENAME.length - 1)
      : customPath;
    const configPath = customPath.endsWith(".json") ? customPath : join(customPath, CONFIG_FILENAME);
    return { dir, configPath, exists: existsSync(configPath) };
  }

  // Check OPENCLAW_STATE_DIR env, then default
  const stateDir = process.env.OPENCLAW_STATE_DIR || DEFAULT_OPENCLAW_DIR;
  const configPath = join(stateDir, CONFIG_FILENAME);
  return { dir: stateDir, configPath, exists: existsSync(configPath) };
}

/**
 * Read and parse openclaw.json.
 *
 * @param {string} configPath - Full path to openclaw.json.
 * @returns {object} Parsed config object.
 * @throws {Error} If file cannot be read or parsed.
 */
export function readConfig(configPath) {
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Write config object back to openclaw.json.
 *
 * @param {string} configPath - Full path to openclaw.json.
 * @param {object} config - Config object to serialize.
 */
function writeConfig(configPath, config) {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Read the inspector state file (stores original provider URLs).
 *
 * @param {string} openclawDir - Path to ~/.openclaw.
 * @returns {object|null} State object or null if not found.
 */
function readState(openclawDir) {
  const statePath = join(openclawDir, STATE_FILENAME);
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Write the inspector state file.
 *
 * @param {string} openclawDir - Path to ~/.openclaw.
 * @param {object} state - State object to persist.
 */
function writeState(openclawDir, state) {
  const statePath = join(openclawDir, STATE_FILENAME);
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/**
 * Remove the inspector state file.
 *
 * @param {string} openclawDir - Path to ~/.openclaw.
 */
function removeState(openclawDir) {
  const statePath = join(openclawDir, STATE_FILENAME);
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }
}

/**
 * Restart the OpenClaw gateway via CLI.
 *
 * @returns {{ ok: boolean, output: string }}
 */
export function restartGateway() {
  try {
    const output = execSync("openclaw gateway restart", {
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: err.stderr || err.message };
  }
}

/**
 * Enable interception: patch openclaw.json to route all providers through
 * the inspector proxy.
 *
 * Steps:
 *   1. Create backup of openclaw.json
 *   2. Detect active providers (from auth-profiles + config)
 *   3. Save original URLs to .inspector-state.json
 *   4. Patch config: set baseUrl to proxy for each provider
 *   5. Restart gateway
 *
 * @param {object} params
 * @param {string} params.configPath - Path to openclaw.json.
 * @param {string} params.openclawDir - Path to ~/.openclaw.
 * @param {number} params.port - Inspector proxy port.
 * @returns {{ ok: boolean, message: string, providers: string[] }}
 *
 * Example:
 *   >>> enable({ configPath: "~/.openclaw/openclaw.json", openclawDir: "~/.openclaw", port: 18800 })
 *   { ok: true, message: "Enabled 3 providers", providers: ["anthropic", "byteplus", "ollama"] }
 */
export function enable({ configPath, openclawDir, port }) {
  const proxyBase = `http://127.0.0.1:${port}`;

  // 0. Guard: if already enabled, refuse to double-enable
  //    This prevents overwriting originals with proxy URLs.
  const existingState = readState(openclawDir);
  if (existingState?.enabled && Object.keys(existingState.originals || {}).length > 0) {
    return {
      ok: true,
      message: "Already enabled",
      providers: Object.keys(existingState.originals),
    };
  }

  // 1. Backup — only if no existing backup (prevents overwriting clean backup)
  const backupPath = configPath + ".inspector-backup";
  if (!existsSync(backupPath)) {
    copyFileSync(configPath, backupPath);
  }

  // 2. Read config
  const config = readConfig(configPath);
  if (!config.models) config.models = {};
  if (!config.models.providers) config.models.providers = {};

  const providers = config.models.providers;
  const originals = {}; // provider -> original baseUrl or null (for built-in)
  const enabled = [];

  // 3. Patch custom providers (already have baseUrl in config)
  for (const [name, cfg] of Object.entries(providers)) {
    if (cfg.baseUrl && !cfg.baseUrl.startsWith(proxyBase)) {
      originals[name] = { baseUrl: cfg.baseUrl, wasCustom: true };
      cfg.baseUrl = `${proxyBase}/${name}`;
      enabled.push(name);
    } else if (cfg.baseUrl && cfg.baseUrl.startsWith(proxyBase)) {
      // Already proxied — skip but don't lose the original
      // Try to resolve from BUILTIN_URLS
      if (BUILTIN_URLS[name]) {
        originals[name] = { baseUrl: BUILTIN_URLS[name], wasCustom: true };
      }
      enabled.push(name);
    }
  }

  // 4. Add built-in providers that have auth but no config entry yet
  const active = detectActiveProviders(openclawDir);
  for (const name of active) {
    if (providers[name]) continue; // Already patched above
    if (!BUILTIN_URLS[name]) continue; // Unknown provider

    originals[name] = { baseUrl: BUILTIN_URLS[name], wasCustom: false };
    providers[name] = {
      baseUrl: `${proxyBase}/${name}`,
      models: [],
    };
    enabled.push(name);
  }

  // 5. Validate: refuse to save if originals is empty (means nothing to restore)
  if (Object.keys(originals).length === 0 && enabled.length === 0) {
    return {
      ok: false,
      message: "No providers found to intercept",
      providers: [],
    };
  }

  // 6. Save state for restore
  writeState(openclawDir, {
    enabled: true,
    port,
    timestamp: new Date().toISOString(),
    originals,
    backupPath,
  });

  // 7. Write patched config
  writeConfig(configPath, config);

  // 8. Restart gateway
  const restart = restartGateway();

  return {
    ok: restart.ok,
    message: restart.ok
      ? `Enabled ${enabled.length} providers`
      : `Config patched but gateway restart failed: ${restart.output}`,
    providers: enabled,
  };
}

/**
 * Disable interception: restore openclaw.json to original state.
 *
 * @param {object} params
 * @param {string} params.configPath - Path to openclaw.json.
 * @param {string} params.openclawDir - Path to ~/.openclaw.
 * @returns {{ ok: boolean, message: string }}
 */
export function disable({ configPath, openclawDir }) {
  const state = readState(openclawDir);

  const hasOriginals = state?.originals && Object.keys(state.originals).length > 0;

  if (!hasOriginals) {
    // No valid originals — try restoring from backup file
    const backupPath = state?.backupPath || configPath + ".inspector-backup";
    if (existsSync(backupPath)) {
      // Verify backup is clean (doesn't contain proxy URLs)
      try {
        const backupContent = readFileSync(backupPath, "utf-8");
        if (!backupContent.includes("127.0.0.1:18800")) {
          copyFileSync(backupPath, configPath);
          removeState(openclawDir);
          const restart = restartGateway();
          return {
            ok: restart.ok,
            message: restart.ok ? "Restored from clean backup" : "Restored config but gateway restart failed",
          };
        }
        // Backup is also corrupted — fall through to manual cleanup
      } catch { /* ignore */ }
    }

    // Last resort: scan config for proxy URLs and replace with BUILTIN_URLS
    const cleaned = cleanProxyUrls(configPath);
    if (cleaned) {
      removeState(openclawDir);
      const restart = restartGateway();
      return {
        ok: restart.ok,
        message: restart.ok ? "Cleaned proxy URLs from config" : "Config cleaned but gateway restart failed",
      };
    }

    removeState(openclawDir);
    return { ok: false, message: "No inspector state or backup found — nothing to restore" };
  }

  // Happy path: restore from originals
  const config = readConfig(configPath);
  const providers = config.models?.providers || {};

  for (const [name, orig] of Object.entries(state.originals)) {
    if (orig.wasCustom) {
      if (providers[name]) {
        providers[name].baseUrl = orig.baseUrl;
      }
    } else {
      // Remove the entry we added for built-in providers
      delete providers[name];
    }
  }

  writeConfig(configPath, config);
  removeState(openclawDir);

  // Clean up backup file
  const backupPath = state?.backupPath || configPath + ".inspector-backup";
  try { if (existsSync(backupPath)) unlinkSync(backupPath); } catch { /* ignore */ }

  const restart = restartGateway();

  return {
    ok: restart.ok,
    message: restart.ok ? "Disabled — config restored" : "Config restored but gateway restart failed",
  };
}

/**
 * Emergency cleanup: scan config for proxy URLs and replace with known originals.
 *
 * @param {string} configPath - Path to openclaw.json.
 * @returns {boolean} True if any cleanup was performed.
 */
function cleanProxyUrls(configPath) {
  try {
    const config = readConfig(configPath);
    const providers = config.models?.providers || {};
    let cleaned = false;

    for (const [name, cfg] of Object.entries(providers)) {
      if (cfg.baseUrl && cfg.baseUrl.includes("127.0.0.1:18800")) {
        if (BUILTIN_URLS[name]) {
          // Known provider — restore builtin URL
          cfg.baseUrl = BUILTIN_URLS[name];
          cleaned = true;
        } else if (cfg.models && cfg.models.length > 0) {
          // Custom provider with models — remove the broken baseUrl
          // Can't know original URL, but removing it is better than dead proxy
          delete cfg.baseUrl;
          cleaned = true;
        } else {
          // Empty provider entry added by inspector — remove entirely
          delete providers[name];
          cleaned = true;
        }
      }
    }

    if (cleaned) {
      writeConfig(configPath, config);
    }
    return cleaned;
  } catch {
    return false;
  }
}

/**
 * Check current interception status.
 *
 * @param {string} openclawDir - Path to ~/.openclaw.
 * @returns {{ enabled: boolean, providers: string[], port: number|null }}
 */
export function status(openclawDir) {
  const state = readState(openclawDir);
  if (!state || !state.enabled) {
    return { enabled: false, providers: [], port: null };
  }
  return {
    enabled: true,
    providers: Object.keys(state.originals || {}),
    port: state.port || null,
  };
}
