#!/usr/bin/env node
/**
 * ServerOS developer CLI.
 *
 * Build and ship themes for a Foundry customer panel from your own editor:
 *
 *   serveros login --api https://panel.example.com/api/v1 --key sos_...
 *   serveros theme init my-theme
 *   serveros theme dev        # push draft on every save + preview URL
 *   serveros theme publish    # ship it to customers
 *
 * A theme is a directory:
 *
 *   config/settings.json     design tokens (become CSS variables)
 *   assets/theme.css         custom CSS, injected after panel styles
 *   assets/theme.js          custom JS, runs on every panel page
 *   templates/*.liquid       Liquid templates for themable surfaces
 *
 * Zero dependencies; Node 18+ (built-in fetch).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const CREDENTIALS_PATH = join(homedir(), ".serveros", "credentials.json");
const TOKEN_NAME_PATTERN = /^[a-z][a-z0-9-]{0,49}$/;

/** Panel surfaces a templates/*.liquid file may target. */
const TEMPLATE_SURFACES = ["servers", "header", "footer"];

const args = process.argv.slice(2);
const flags = {};
const positional = [];

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const name = args[i].slice(2);
    const next = args[i + 1];

    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  } else {
    positional.push(args[i]);
  }
}

if (flags.insecure) {
  // Local panels on self-signed certs (Herd, Valet). Never use in prod.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const log = (message) => console.log(message);
const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exit(1);
};

function savedCredentials() {
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function config() {
  const saved = savedCredentials();
  const api = flags.api ?? process.env.SERVEROS_API ?? saved.api;
  const key = flags.key ?? process.env.SERVEROS_API_KEY ?? saved.key;

  if (!api) {
    fail(
      "No API endpoint. Run `serveros login --api https://your-panel/api/v1 --key sos_...` or pass --api.",
    );
  }

  if (!key) {
    fail(
      "No API key. Run `serveros login`, set SERVEROS_API_KEY, or pass --key. Mint keys in Foundry → API & modules.",
    );
  }

  return { api: api.replace(/\/+$/, ""), key };
}

async function request(method, path, body) {
  const { api, key } = config();

  let response;

  try {
    response = await fetch(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    fail(
      `Could not reach ${api}${path} — ${error.cause?.code ?? error.message}. Local panel on a self-signed cert? Add --insecure.`,
    );
  }

  const text = await response.text();
  let json = {};

  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON error page; keep json empty.
  }

  if (!response.ok) {
    const detail = json.message ?? `HTTP ${response.status}`;
    const errors = json.errors ? ` ${JSON.stringify(json.errors)}` : "";
    fail(`${method} ${path} failed: ${detail}${errors}`);
  }

  return json;
}

function themeDir() {
  return resolve(flags.dir ?? ".");
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function readTheme(dir) {
  const settingsPath = join(dir, "config", "settings.json");
  const templatesDir = join(dir, "templates");
  const legacyTokensPath = join(dir, "theme.json");

  const isThemeDir =
    existsSync(settingsPath) ||
    existsSync(templatesDir) ||
    existsSync(join(dir, "assets"));

  if (!isThemeDir && !existsSync(legacyTokensPath)) {
    fail(
      `No theme in ${dir}. Run \`serveros theme init\` first, or pass --dir.`,
    );
  }

  let tokens = {};
  let css = null;
  let js = null;
  const templates = {};

  if (isThemeDir) {
    if (existsSync(settingsPath)) {
      try {
        tokens = JSON.parse(readFileSync(settingsPath, "utf8")).tokens ?? {};
      } catch (error) {
        fail(`config/settings.json is not valid JSON: ${error.message}`);
      }
    }

    css = readOptional(join(dir, "assets", "theme.css"));
    js = readOptional(join(dir, "assets", "theme.js"));

    if (existsSync(templatesDir)) {
      for (const file of readdirSync(templatesDir)) {
        if (!file.endsWith(".liquid")) {
          continue;
        }

        const surface = basename(file, ".liquid");

        if (!TEMPLATE_SURFACES.includes(surface)) {
          log(
            `⚠ templates/${file} skipped — themable surfaces are: ${TEMPLATE_SURFACES.join(", ")}`,
          );
          continue;
        }

        templates[surface] = readFileSync(join(templatesDir, file), "utf8");
      }
    }
  } else {
    // Legacy single-file layout (theme.json + theme.css).
    try {
      tokens = JSON.parse(readFileSync(legacyTokensPath, "utf8")).tokens ?? {};
    } catch (error) {
      fail(`theme.json is not valid JSON: ${error.message}`);
    }

    css = readOptional(join(dir, "theme.css"));
  }

  for (const name of Object.keys(tokens)) {
    if (!TOKEN_NAME_PATTERN.test(name)) {
      log(
        `⚠ token "${name}" will be dropped by the panel — names must match ${TOKEN_NAME_PATTERN}`,
      );
    }
  }

  return { tokens, css, js, templates };
}

function writeTheme(dir, theme) {
  mkdirSync(join(dir, "config"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "templates"), { recursive: true });

  writeFileSync(
    join(dir, "config", "settings.json"),
    `${JSON.stringify({ tokens: theme?.tokens ?? {} }, null, 4)}\n`,
  );
  writeFileSync(join(dir, "assets", "theme.css"), theme?.css ?? "");
  writeFileSync(join(dir, "assets", "theme.js"), theme?.js ?? "");

  for (const [surface, template] of Object.entries(theme?.templates ?? {})) {
    writeFileSync(join(dir, "templates", `${surface}.liquid`), template);
  }
}

async function login() {
  const api = flags.api ?? process.env.SERVEROS_API;
  const key = flags.key ?? process.env.SERVEROS_API_KEY;

  if (!api || !key) {
    fail(
      "Usage: serveros login --api https://your-panel/api/v1 --key sos_... (mint keys in Foundry → API & modules)",
    );
  }

  mkdirSync(join(homedir(), ".serveros"), { recursive: true });
  writeFileSync(
    CREDENTIALS_PATH,
    `${JSON.stringify({ api: api.replace(/\/+$/, ""), key }, null, 4)}\n`,
  );

  const status = await request("GET", "/theme");

  log(`✔ Logged in. Credentials saved to ${CREDENTIALS_PATH}`);
  log(`  Panel preview: ${status.preview_url}`);
}

const STARTER_TOKENS = {
  primary: "#7a5fff",
  radius: "0.5rem",
};

const STARTER_CSS = `/*
 * Theme stylesheet — injected after the panel's own styles, so anything
 * here wins. Tokens from config/settings.json are available as CSS
 * variables: var(--primary), var(--radius), ...
 *
 * Style your Liquid templates with your own classes; the panel's utility
 * classes are compiled per-build and are not available to templates.
 */

.theme-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px;
}

.theme-title {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.5px;
}

.theme-subtitle {
    font-size: 13px;
    color: var(--muted-foreground, #a1a2aa);
}

.theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
}

.theme-card {
    display: flex;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
    background: var(--card, #14151b);
    border-radius: var(--radius, 0.5rem);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s ease;
}

.theme-card:hover {
    border-color: var(--primary, #7a5fff);
}

.theme-art {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: 6px;
}

.theme-card-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.theme-meta {
    font-size: 12px;
    color: var(--muted-foreground, #a1a2aa);
}

.theme-status {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

.theme-status-online {
    color: #33df69;
}

.theme-status-offline {
    color: #ff5f6b;
}

.theme-status-installing {
    color: var(--primary, #7a5fff);
}

.theme-empty {
    padding: 48px 24px;
    text-align: center;
    font-size: 13px;
    color: var(--muted-foreground, #a1a2aa);
}
`;

const STARTER_JS = `/*
 * Theme JavaScript — runs once per full page load, on every panel page.
 *
 * window.ServerOS         -> { tenant, viewer }
 * 'serveros:ready'        -> fired right after this script runs
 * 'serveros:navigate'     -> fired after client-side navigations; re-apply
 *                            DOM changes here (detail: { url })
 */

// window.addEventListener('serveros:navigate', (event) => {
//     console.log('navigated to', event.detail.url);
// });
`;

const STARTER_SERVERS = `{% comment %}
    Your servers page — this template fully replaces the stock dashboard.
    Data: servers, embeds, tenant, viewer.
    Server fields: uid, name, workload, status, region, players, cpu,
    memoryUsedMb, memoryTotalMb, ip, port, artUrl, shared, owner.
{% endcomment %}
<div class="theme-page">
    <h1 class="theme-title">{{ tenant.name }}</h1>
    <p class="theme-subtitle">
        Welcome back{% if viewer %}, {{ viewer.name | split: " " | first }}{% endif %}
        — {{ servers | size }} server{% if servers.size != 1 %}s{% endif %} on your account.
    </p>

    <div class="theme-grid">
        {% for server in servers %}
            <a class="theme-card" href="/servers/{{ server.uid }}">
                {% if server.artUrl %}
                    <img class="theme-art" src="{{ server.artUrl }}" alt="" />
                {% endif %}
                <span class="theme-card-body">
                    <strong>{{ server.name }}</strong>
                    <span class="theme-meta">
                        {{ server.workload }}{% if server.ip %} · {{ server.ip }}:{{ server.port }}{% endif %}
                    </span>
                    <span class="theme-status theme-status-{{ server.status }}">{{ server.status }}</span>
                </span>
            </a>
        {% else %}
            <p class="theme-empty">No servers yet — they appear here right after checkout.</p>
        {% endfor %}
    </div>

    {% for embed in embeds %}
        <iframe
            src="{{ embed.url }}"
            title="{{ embed.name }}"
            style="width: 100%; border: 0; min-height: 260px"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
    {% endfor %}
</div>
`;

function init() {
  const dir = resolve(positional[2] ?? flags.dir ?? ".");

  if (existsSync(join(dir, "config", "settings.json")) && !flags.force) {
    fail(`${dir} already has a theme — pass --force to overwrite.`);
  }

  writeTheme(dir, {
    tokens: STARTER_TOKENS,
    css: STARTER_CSS,
    js: STARTER_JS,
    templates: { servers: STARTER_SERVERS },
  });

  log(`✔ Theme scaffolded in ${dir}`);
  log("  config/settings.json      design tokens (become CSS variables)");
  log("  assets/theme.css          custom CSS, injected after panel styles");
  log("  assets/theme.js           custom JS, runs on every panel page");
  log(
    `  templates/*.liquid        Liquid templates (${TEMPLATE_SURFACES.join(", ")})`,
  );
  log("");
  log("Next: serveros theme dev   (from inside the theme directory)");
}

async function push({ quiet = false } = {}) {
  const theme = readTheme(themeDir());
  const result = await request("PUT", "/theme", theme);

  if (!quiet) {
    log("✔ Draft pushed.");
    log(`  Preview (sign in as the org owner): ${result.preview_url}`);
    log("  Publish when ready: serveros theme publish");
  }

  return result;
}

async function pull() {
  const status = await request("GET", "/theme");
  const source = flags.published
    ? status.published
    : (status.draft ?? status.published);

  if (!source) {
    fail(
      "Nothing to pull — this panel has no theme yet. Run `serveros theme init` to start one.",
    );
  }

  writeTheme(themeDir(), source);
  log(
    `✔ Pulled the ${flags.published ? "published" : "draft"} theme into ${themeDir()}`,
  );
}

async function publish() {
  const result = await request("POST", "/theme/publish");

  log("✔ Published — customers see it now.");
  log(`  Live panel: ${result.preview_url.replace("/?theme=draft", "")}`);
}

function describe(state) {
  if (!state) {
    return "—";
  }

  const parts = [
    `${Object.keys(state.tokens ?? {}).length} tokens`,
    state.css ? `${state.css.length}B CSS` : "no CSS",
    state.js ? `${state.js.length}B JS` : "no JS",
    `${Object.keys(state.templates ?? {}).length} templates`,
  ];

  return parts.join(", ");
}

async function status() {
  const state = await request("GET", "/theme");

  log(
    `Draft:     ${state.draft ? `${describe(state.draft)} (updated ${state.draft_updated_at})` : "—"}`,
  );
  log(
    `Published: ${state.published ? `${describe(state.published)} (published ${state.published_at})` : "—"}`,
  );
  log(`Preview:   ${state.preview_url}`);
}

async function reset() {
  await request("DELETE", "/theme");
  log("✔ Theme cleared — the panel is back to stock.");
}

async function dev() {
  const dir = themeDir();
  const result = await push({ quiet: true });

  log(`✔ Draft pushed. Watching ${dir} for changes…`);
  log(
    `  Preview (sign in as the org owner, refresh to see saves): ${result.preview_url}`,
  );
  log("  Stop with Ctrl+C, then `serveros theme publish` to ship.");

  let timer = null;

  const schedule = (filename) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await push({ quiet: true });
        log(`  ↑ pushed ${filename} at ${new Date().toLocaleTimeString()}`);
      } catch {
        // fail() already printed and exited on hard errors.
      }
    }, 200);
  };

  const relevant = (filename) =>
    filename !== null &&
    (filename.endsWith(".liquid") ||
      filename.endsWith(".css") ||
      filename.endsWith(".js") ||
      filename.endsWith("settings.json") ||
      filename === "theme.json" ||
      filename === "theme.css");

  for (const sub of ["", "config", "assets", "templates"]) {
    const target = sub === "" ? dir : join(dir, sub);

    if (!existsSync(target)) {
      continue;
    }

    watch(target, (eventType, filename) => {
      if (relevant(filename)) {
        schedule(sub === "" ? filename : `${sub}/${filename}`);
      }
    });
  }
}

const HELP = `ServerOS developer CLI

Usage:
  serveros login --api <url> --key <sos_...>   Save panel credentials (~/.serveros)
  serveros theme init [dir]                    Scaffold a theme (config, assets, templates)
  serveros theme dev                           Push draft on every save, print preview URL
  serveros theme push                          Push the local theme as the draft
  serveros theme pull [--published]            Download the panel's theme into local files
  serveros theme publish                       Copy the draft to the live panel
  serveros theme status                        Show draft/published state
  serveros theme reset                         Remove the theme, back to stock

Options:
  --dir <path>     Theme directory (default: current directory)
  --api <url>      Panel API base, e.g. https://panel.example.com/api/v1
  --key <key>      Organization API key (Foundry → API & modules)
  --insecure       Accept self-signed certificates (local panels only)

Auth resolution: --key flag, then SERVEROS_API_KEY, then saved login.`;

const command = positional[0];
const sub = positional[1];

try {
  if (command === "login") {
    await login();
  } else if (command === "theme" && sub === "init") {
    init();
  } else if (command === "theme" && sub === "dev") {
    await dev();
  } else if (command === "theme" && sub === "push") {
    await push();
  } else if (command === "theme" && sub === "pull") {
    await pull();
  } else if (command === "theme" && sub === "publish") {
    await publish();
  } else if (command === "theme" && sub === "status") {
    await status();
  } else if (command === "theme" && sub === "reset") {
    await reset();
  } else {
    log(HELP);
    process.exit(command === undefined || command === "help" ? 0 : 1);
  }
} catch (error) {
  fail(error.message);
}
