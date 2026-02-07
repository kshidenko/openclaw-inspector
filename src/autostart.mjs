/**
 * Autostart management for OpenClaw Inspector.
 *
 * Installs/uninstalls a system service so the inspector starts
 * automatically on login (macOS) or boot (Linux).
 *
 * Supported platforms:
 *   - macOS: launchd (~/Library/LaunchAgents/)
 *   - Linux: systemd user unit (~/.config/systemd/user/)
 *
 * @module autostart
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** launchd plist label / systemd unit name. */
const SERVICE_ID = "com.openclaw.inspector";

/** systemd unit file name. */
const SYSTEMD_UNIT = "oc-inspector.service";

/**
 * Resolve the absolute path to the CLI entry point (bin/cli.mjs).
 *
 * @returns {string} Absolute path to cli.mjs.
 */
function cliPath() {
  const thisFile = fileURLToPath(import.meta.url);
  return join(thisFile, "..", "..", "bin", "cli.mjs");
}

/**
 * Resolve the absolute path to the current Node.js binary.
 *
 * @returns {string} Absolute path to `node`.
 */
function nodePath() {
  return process.execPath;
}

// ════════════════════════════════════════════════════════════════
// macOS — launchd
// ════════════════════════════════════════════════════════════════

/**
 * Path to the launchd plist file.
 *
 * @returns {string} ~/Library/LaunchAgents/com.openclaw.inspector.plist
 */
function plistPath() {
  return join(homedir(), "Library", "LaunchAgents", `${SERVICE_ID}.plist`);
}

/**
 * Generate a launchd plist XML string.
 *
 * The plist tells launchd to run `node bin/cli.mjs _serve --port <port>`
 * at login, keep it alive (restart on crash), and log stdout/stderr.
 *
 * @param {object} opts
 * @param {number} opts.port - Inspector proxy port.
 * @param {string} [opts.config] - Custom openclaw.json path.
 * @returns {string} Plist XML content.
 */
function buildPlist({ port, config }) {
  const args = [nodePath(), cliPath(), "_serve", "--port", String(port)];
  if (config) args.push("--config", config);

  const logDir = join(homedir(), ".openclaw", ".inspector-runtime");
  const stdout = join(logDir, "launchd-stdout.log");
  const stderr = join(logDir, "launchd-stderr.log");

  const argsXml = args.map((a) => `      <string>${escapeXml(a)}</string>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_ID}</string>

    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${escapeXml(stdout)}</string>

    <key>StandardErrorPath</key>
    <string>${escapeXml(stderr)}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
`;
}

/**
 * Escape special XML characters.
 *
 * @param {string} s - Raw string.
 * @returns {string} XML-safe string.
 */
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Install the launchd agent on macOS.
 *
 * @param {object} opts
 * @param {number} opts.port - Inspector port.
 * @param {string} [opts.config] - Custom openclaw.json path.
 * @returns {{ ok: boolean, message: string, path: string }}
 */
function installLaunchd({ port, config }) {
  const path = plistPath();
  const dir = join(homedir(), "Library", "LaunchAgents");
  mkdirSync(dir, { recursive: true });

  // Ensure log directory exists
  mkdirSync(join(homedir(), ".openclaw", ".inspector-runtime"), { recursive: true });

  // Unload if already loaded
  try {
    execSync(`launchctl unload "${path}" 2>/dev/null`, { stdio: "pipe" });
  } catch { /* not loaded — fine */ }

  // Write plist
  const content = buildPlist({ port, config });
  writeFileSync(path, content, "utf-8");

  // Load the agent
  try {
    execSync(`launchctl load "${path}"`, { stdio: "pipe" });
  } catch (err) {
    return { ok: false, message: `Plist written but launchctl load failed: ${err.message}`, path };
  }

  return { ok: true, message: "Autostart installed (launchd)", path };
}

/**
 * Uninstall the launchd agent on macOS.
 *
 * @returns {{ ok: boolean, message: string }}
 */
function uninstallLaunchd() {
  const path = plistPath();
  if (!existsSync(path)) {
    return { ok: true, message: "Autostart was not installed" };
  }

  // Unload
  try {
    execSync(`launchctl unload "${path}" 2>/dev/null`, { stdio: "pipe" });
  } catch { /* ignore */ }

  // Remove file
  try {
    unlinkSync(path);
  } catch (err) {
    return { ok: false, message: `Failed to remove plist: ${err.message}` };
  }

  return { ok: true, message: "Autostart removed (launchd)" };
}

/**
 * Check if the launchd agent is installed.
 *
 * @returns {{ installed: boolean, running: boolean, path: string }}
 */
function statusLaunchd() {
  const path = plistPath();
  const installed = existsSync(path);
  let running = false;
  if (installed) {
    try {
      const out = execSync(`launchctl list ${SERVICE_ID} 2>/dev/null`, { stdio: "pipe" }).toString();
      running = !out.includes("Could not find");
    } catch {
      running = false;
    }
  }
  return { installed, running, path };
}

// ════════════════════════════════════════════════════════════════
// Linux — systemd user unit
// ════════════════════════════════════════════════════════════════

/**
 * Path to the systemd user unit file.
 *
 * @returns {string} ~/.config/systemd/user/oc-inspector.service
 */
function unitPath() {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT);
}

/**
 * Generate a systemd user unit file content.
 *
 * @param {object} opts
 * @param {number} opts.port - Inspector proxy port.
 * @param {string} [opts.config] - Custom openclaw.json path.
 * @returns {string} Unit file content.
 */
function buildUnit({ port, config }) {
  const args = [cliPath(), "_serve", "--port", String(port)];
  if (config) args.push("--config", config);

  return `[Unit]
Description=OpenClaw Inspector — LLM API traffic monitor
After=network.target

[Service]
Type=simple
ExecStart=${nodePath()} ${args.join(" ")}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

/**
 * Install the systemd user service on Linux.
 *
 * @param {object} opts
 * @param {number} opts.port - Inspector port.
 * @param {string} [opts.config] - Custom openclaw.json path.
 * @returns {{ ok: boolean, message: string, path: string }}
 */
function installSystemd({ port, config }) {
  const path = unitPath();
  const dir = join(homedir(), ".config", "systemd", "user");
  mkdirSync(dir, { recursive: true });

  // Write unit
  const content = buildUnit({ port, config });
  writeFileSync(path, content, "utf-8");

  // Reload and enable
  try {
    execSync("systemctl --user daemon-reload", { stdio: "pipe" });
    execSync(`systemctl --user enable ${SYSTEMD_UNIT}`, { stdio: "pipe" });
    execSync(`systemctl --user restart ${SYSTEMD_UNIT}`, { stdio: "pipe" });
  } catch (err) {
    return { ok: false, message: `Unit written but systemctl failed: ${err.message}`, path };
  }

  return { ok: true, message: "Autostart installed (systemd)", path };
}

/**
 * Uninstall the systemd user service on Linux.
 *
 * @returns {{ ok: boolean, message: string }}
 */
function uninstallSystemd() {
  const path = unitPath();
  if (!existsSync(path)) {
    return { ok: true, message: "Autostart was not installed" };
  }

  try {
    execSync(`systemctl --user stop ${SYSTEMD_UNIT} 2>/dev/null`, { stdio: "pipe" });
    execSync(`systemctl --user disable ${SYSTEMD_UNIT} 2>/dev/null`, { stdio: "pipe" });
  } catch { /* ignore */ }

  try {
    unlinkSync(path);
    execSync("systemctl --user daemon-reload", { stdio: "pipe" });
  } catch (err) {
    return { ok: false, message: `Failed to remove unit: ${err.message}` };
  }

  return { ok: true, message: "Autostart removed (systemd)" };
}

/**
 * Check if the systemd user service is installed.
 *
 * @returns {{ installed: boolean, running: boolean, path: string }}
 */
function statusSystemd() {
  const path = unitPath();
  const installed = existsSync(path);
  let running = false;
  if (installed) {
    try {
      const out = execSync(`systemctl --user is-active ${SYSTEMD_UNIT} 2>/dev/null`, { stdio: "pipe" }).toString().trim();
      running = out === "active";
    } catch {
      running = false;
    }
  }
  return { installed, running, path };
}

// ════════════════════════════════════════════════════════════════
// Public API — platform-agnostic
// ════════════════════════════════════════════════════════════════

/**
 * Install autostart service for the current platform.
 *
 * @param {object} opts
 * @param {number} opts.port - Inspector proxy port (default: 3000).
 * @param {string} [opts.config] - Custom openclaw.json path.
 * @returns {{ ok: boolean, message: string, path?: string }}
 *
 * @throws {Error} If the platform is not supported.
 *
 * Example:
 *   >>> import { install } from './autostart.mjs';
 *   >>> const result = install({ port: 3000 });
 *   >>> console.log(result.message);
 */
export function install({ port = 3000, config } = {}) {
  const os = platform();
  if (os === "darwin") return installLaunchd({ port, config });
  if (os === "linux") return installSystemd({ port, config });
  return { ok: false, message: `Unsupported platform: ${os}. Only macOS and Linux are supported.` };
}

/**
 * Uninstall autostart service for the current platform.
 *
 * @returns {{ ok: boolean, message: string }}
 *
 * Example:
 *   >>> import { uninstall } from './autostart.mjs';
 *   >>> const result = uninstall();
 *   >>> console.log(result.message);
 */
export function uninstall() {
  const os = platform();
  if (os === "darwin") return uninstallLaunchd();
  if (os === "linux") return uninstallSystemd();
  return { ok: false, message: `Unsupported platform: ${os}. Only macOS and Linux are supported.` };
}

/**
 * Check autostart status for the current platform.
 *
 * @returns {{ installed: boolean, running: boolean, path: string, platform: string }}
 *
 * Example:
 *   >>> import { autostartStatus } from './autostart.mjs';
 *   >>> const s = autostartStatus();
 *   >>> console.log(s.installed, s.running);
 */
export function autostartStatus() {
  const os = platform();
  if (os === "darwin") return { ...statusLaunchd(), platform: "launchd" };
  if (os === "linux") return { ...statusSystemd(), platform: "systemd" };
  return { installed: false, running: false, path: "", platform: os };
}
