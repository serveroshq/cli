#!/usr/bin/env node
/**
 * ServerOS developer CLI.
 *
 * The Shopify-style theme loop against a Foundry panel, no panel source
 * required:
 *
 *   serveros login --api https://panel.example.com/api/v1 --key sos_...
 *   serveros theme init my-theme
 *   serveros theme dev        # push draft on every save + preview URL
 *   serveros theme publish    # ship it to customers
 *
 * Zero dependencies; Node 18+ (built-in fetch).
 */

import {
    existsSync,
    mkdirSync,
    readFileSync,
    watch,
    writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const CREDENTIALS_PATH = join(homedir(), '.serveros', 'credentials.json');
const TOKEN_NAME_PATTERN = /^[a-z][a-z0-9-]{0,49}$/;

const args = process.argv.slice(2);
const flags = {};
const positional = [];

for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
        const name = args[i].slice(2);
        const next = args[i + 1];

        if (next !== undefined && !next.startsWith('--')) {
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
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const log = (message) => console.log(message);
const fail = (message) => {
    console.error(`✖ ${message}`);
    process.exit(1);
};

// --- Config ---------------------------------------------------------------------

function savedCredentials() {
    try {
        return JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
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
            'No API endpoint. Run `serveros login --api https://your-panel/api/v1 --key sos_...` or pass --api.',
        );
    }

    if (!key) {
        fail(
            'No API key. Run `serveros login`, set SERVEROS_API_KEY, or pass --key. Mint keys in Foundry → API & modules.',
        );
    }

    return { api: api.replace(/\/+$/, ''), key };
}

async function request(method, path, body) {
    const { api, key } = config();

    let response;

    try {
        response = await fetch(`${api}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
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
        const errors = json.errors ? ` ${JSON.stringify(json.errors)}` : '';
        fail(`${method} ${path} failed: ${detail}${errors}`);
    }

    return json;
}

// --- Theme files ----------------------------------------------------------------

function themeDir() {
    return resolve(flags.dir ?? '.');
}

function readTheme(dir) {
    const tokensPath = join(dir, 'theme.json');
    const cssPath = join(dir, 'theme.css');

    if (!existsSync(tokensPath)) {
        fail(
            `No theme.json in ${dir}. Run \`serveros theme init\` first, or pass --dir.`,
        );
    }

    let parsed;

    try {
        parsed = JSON.parse(readFileSync(tokensPath, 'utf8'));
    } catch (error) {
        fail(`theme.json is not valid JSON: ${error.message}`);
    }

    const tokens = parsed.tokens ?? {};

    for (const name of Object.keys(tokens)) {
        if (!TOKEN_NAME_PATTERN.test(name)) {
            log(
                `⚠ token "${name}" will be dropped by the panel — names must match ${TOKEN_NAME_PATTERN}`,
            );
        }
    }

    const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : null;

    return { tokens, css };
}

function writeTheme(dir, theme) {
    writeFileSync(
        join(dir, 'theme.json'),
        `${JSON.stringify({ tokens: theme?.tokens ?? {} }, null, 4)}\n`,
    );
    writeFileSync(join(dir, 'theme.css'), theme?.css ?? '');
}

// --- Commands -------------------------------------------------------------------

async function login() {
    const api = flags.api ?? process.env.SERVEROS_API;
    const key = flags.key ?? process.env.SERVEROS_API_KEY;

    if (!api || !key) {
        fail(
            'Usage: serveros login --api https://your-panel/api/v1 --key sos_... (mint keys in Foundry → API & modules)',
        );
    }

    mkdirSync(join(homedir(), '.serveros'), { recursive: true });
    writeFileSync(
        CREDENTIALS_PATH,
        `${JSON.stringify({ api: api.replace(/\/+$/, ''), key }, null, 4)}\n`,
    );

    const status = await request('GET', '/theme');

    log(`✔ Logged in. Credentials saved to ${CREDENTIALS_PATH}`);
    log(`  Panel preview: ${status.preview_url}`);
}

const STARTER_TOKENS = {
    primary: '#7a5fff',
    radius: '0.5rem',
};

const STARTER_CSS = `/*
 * Custom CSS for your customer panel. Injected after the panel's own
 * styles, so anything here wins. Design tokens live in theme.json and
 * are available as CSS variables: var(--primary), var(--radius), ...
 */

/* Example: give the whole panel a subtle brand tint on hover rows.
[data-slot='sidebar'] a:hover {
    color: var(--primary);
}
*/
`;

function init() {
    const dir = resolve(positional[2] ?? flags.dir ?? '.');

    mkdirSync(dir, { recursive: true });

    if (existsSync(join(dir, 'theme.json')) && !flags.force) {
        fail(`${dir} already has a theme.json — pass --force to overwrite.`);
    }

    writeTheme(dir, { tokens: STARTER_TOKENS, css: STARTER_CSS });

    log(`✔ Theme scaffolded in ${dir}`);
    log('  theme.json — design tokens (become CSS variables on the panel)');
    log('  theme.css  — custom CSS, injected after the panel styles');
    log('');
    log('Next: serveros theme dev   (from inside the theme directory)');
}

async function push({ quiet = false } = {}) {
    const theme = readTheme(themeDir());
    const result = await request('PUT', '/theme', theme);

    if (!quiet) {
        log('✔ Draft pushed.');
        log(`  Preview (sign in as the org owner): ${result.preview_url}`);
        log('  Publish when ready: serveros theme publish');
    }

    return result;
}

async function pull() {
    const status = await request('GET', '/theme');
    const source = flags.published
        ? status.published
        : (status.draft ?? status.published);

    if (!source) {
        fail(
            'Nothing to pull — this panel has no theme yet. Run `serveros theme init` to start one.',
        );
    }

    writeTheme(themeDir(), source);
    log(
        `✔ Pulled the ${flags.published ? 'published' : 'draft'} theme into ${themeDir()}`,
    );
}

async function publish() {
    const result = await request('POST', '/theme/publish');

    log('✔ Published — customers see it now.');
    log(`  Live panel: ${result.preview_url.replace('/?theme=draft', '')}`);
}

async function status() {
    const state = await request('GET', '/theme');

    log(
        `Draft:     ${state.draft ? `${Object.keys(state.draft.tokens ?? {}).length} tokens, ${state.draft.css ? `${state.draft.css.length} bytes of CSS` : 'no CSS'} (updated ${state.draft_updated_at})` : '—'}`,
    );
    log(
        `Published: ${state.published ? `${Object.keys(state.published.tokens ?? {}).length} tokens, ${state.published.css ? `${state.published.css.length} bytes of CSS` : 'no CSS'} (published ${state.published_at})` : '—'}`,
    );
    log(`Preview:   ${state.preview_url}`);
}

async function reset() {
    await request('DELETE', '/theme');
    log('✔ Theme cleared — the panel is back to stock.');
}

async function dev() {
    const dir = themeDir();
    const result = await push({ quiet: true });

    log(`✔ Draft pushed. Watching ${dir} for changes…`);
    log(
        `  Preview (sign in as the org owner, refresh to see saves): ${result.preview_url}`,
    );
    log('  Stop with Ctrl+C, then `serveros theme publish` to ship.');

    let timer = null;

    watch(dir, (eventType, filename) => {
        if (filename !== 'theme.json' && filename !== 'theme.css') {
            return;
        }

        clearTimeout(timer);
        timer = setTimeout(async () => {
            try {
                await push({ quiet: true });
                log(
                    `  ↑ pushed ${filename} at ${new Date().toLocaleTimeString()}`,
                );
            } catch {
                // fail() already printed and exited on hard errors.
            }
        }, 200);
    });
}

// --- Dispatch -------------------------------------------------------------------

const HELP = `ServerOS developer CLI

Usage:
  serveros login --api <url> --key <sos_...>   Save panel credentials (~/.serveros)
  serveros theme init [dir]                    Scaffold theme.json + theme.css
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
    if (command === 'login') {
        await login();
    } else if (command === 'theme' && sub === 'init') {
        init();
    } else if (command === 'theme' && sub === 'dev') {
        await dev();
    } else if (command === 'theme' && sub === 'push') {
        await push();
    } else if (command === 'theme' && sub === 'pull') {
        await pull();
    } else if (command === 'theme' && sub === 'publish') {
        await publish();
    } else if (command === 'theme' && sub === 'status') {
        await status();
    } else if (command === 'theme' && sub === 'reset') {
        await reset();
    } else {
        log(HELP);
        process.exit(command === undefined || command === 'help' ? 0 : 1);
    }
} catch (error) {
    fail(error.message);
}
