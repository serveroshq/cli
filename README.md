# ServerOS CLI

Build a custom look for your [ServerOS Foundry](https://serveros.com) customer
panel from your own editor — design tokens, CSS, JavaScript, and Liquid
templates, developed locally, previewed as a draft on your live panel, and
published when ready. No panel source code required.

```bash
npm install -g @serveros/cli
```

Requires Node 18+. No dependencies.

## The loop

```bash
# 1. Connect to your panel (mint a key in Foundry → API & modules)
serveros login --api https://your-panel.example.com/api/v1 --key sos_...

# 2. Scaffold a theme
serveros theme init my-theme && cd my-theme

# 3. Develop — every save pushes the draft; refresh the preview URL to see it
serveros theme dev

# 4. Ship it
serveros theme publish
```

The draft never touches what customers see. Preview it live by signing in to
your panel as the organization owner and opening `/?theme=draft` (the CLI
prints the exact URL). `serveros theme reset` returns the panel to stock at
any time.

## Commands

| Command                          | What it does                                                |
| -------------------------------- | ----------------------------------------------------------- |
| `serveros login --api … --key …` | Save panel credentials to `~/.serveros`                     |
| `serveros theme init [dir]`      | Scaffold a theme (config, assets, templates)                |
| `serveros theme dev`             | Watch the theme dir, push the draft on each save            |
| `serveros theme push`            | Push the local theme as the draft                           |
| `serveros theme pull`            | Download the panel's theme (`--published` for the live one) |
| `serveros theme publish`         | Copy the draft to the live panel                            |
| `serveros theme status`          | Show draft/published state                                  |
| `serveros theme reset`           | Remove the theme, back to stock                             |

Options: `--dir <path>` theme directory, `--api <url>` panel API base,
`--key <key>` organization API key, `--insecure` accept self-signed
certificates (local panels only).

## Theme anatomy

A theme is a directory:

| Path                   | What it is                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `config/settings.json` | Design tokens. Each token becomes a CSS variable on the panel (`primary` → `--primary`). |
| `assets/theme.css`     | Custom CSS, injected after the panel's own styles.                                       |
| `assets/theme.js`      | Custom JavaScript, runs on every panel page.                                             |
| `templates/*.liquid`   | [Liquid](https://liquidjs.com) templates that replace themable panel surfaces.           |

Token names must match `^[a-z][a-z0-9-]{0,49}$` — anything else is dropped
server-side (the CLI warns you first).

See [`examples/ember`](examples/ember) for a complete reskin — amber on
charcoal-bronze, square corners, and custom CSS effects.

## Liquid templates

Each `templates/<surface>.liquid` file takes over one panel surface:

| Surface   | Replaces                        | Data available                          |
| --------- | ------------------------------- | --------------------------------------- |
| `servers` | The whole customer dashboard    | `servers`, `embeds`, `tenant`, `viewer` |
| `header`  | A region above every panel page | `tenant`, `viewer`                      |
| `footer`  | A region below every panel page | `tenant`, `viewer`                      |

Server objects carry `uid`, `name`, `workload`, `status`, `region`,
`players`, `cpu`, `memoryUsedMb`, `memoryTotalMb`, `ip`, `port`, `artUrl`,
`shared`, and `owner`. Link to a server with `/servers/{{ server.uid }}`.

Style templates with your own classes in `assets/theme.css` — the panel's
internal utility classes are compiled per-build and not available to
template markup.

Interactive surfaces (live console, file manager, backups) are rendered by
the panel engine and are not templatable; restyle them with tokens/CSS, or
reach into them with theme JavaScript.

## Theme JavaScript

`assets/theme.js` runs once per full page load on every panel page:

- `window.ServerOS` → `{ tenant, viewer }`
- `serveros:ready` event fires right after your script runs
- `serveros:navigate` event fires after client-side navigations
  (`event.detail.url`) — re-apply DOM work there

Theme JS is scoped to your own panel and your own customers, exactly like
theme CSS.

## Token reference

These are the panel's stock values (dark mode, the customer default).
Override any of them; tokens apply in both light and dark mode.

| Token                | Stock (dark)             | Drives                     |
| -------------------- | ------------------------ | -------------------------- |
| `primary`            | `#7a5fff`                | Buttons, focus, accents    |
| `brand`              | `#7a5fff`                | Page-level accents         |
| `background`         | `#0e0f13`                | Page background            |
| `foreground`         | `#ececec`                | Body text                  |
| `card`               | `#14151b`                | Cards, panels              |
| `secondary`          | `#1a1b22`                | Secondary buttons, wells   |
| `muted`              | `#1a1b22`                | Muted fills                |
| `muted-foreground`   | `#a1a2aa`                | Secondary text             |
| `border`             | `rgba(255,255,255,0.1)`  | Borders                    |
| `input`              | `rgba(255,255,255,0.14)` | Input borders              |
| `ring`               | `#7a5fff`                | Focus rings                |
| `destructive`        | `hsl(0 84% 60%)`         | Danger buttons             |
| `radius`             | `0.5rem`                 | Corner rounding            |
| `sidebar`            | `#101116`                | Sidebar background         |
| `sidebar-foreground` | `#d6d7dc`                | Sidebar text               |
| `sidebar-accent`     | `#1a1b22`                | Sidebar hover/active fills |
| `sidebar-border`     | `rgba(255,255,255,0.08)` | Sidebar borders            |

## Auth

Resolution order: `--key` flag → `SERVEROS_API_KEY` env →
`~/.serveros/credentials.json` (written by `serveros login`). Same for
`--api` / `SERVEROS_API`.

## Contributing

Issues and pull requests are welcome — especially example themes. Keep the
CLI dependency-free and Node 18 compatible; `npm run check` must pass.

## License

[MIT](LICENSE)
