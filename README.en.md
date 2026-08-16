# dsh-llm-codex-oauth

English | [中文](README.md)

> This project was built by DeepSeek-V4-Pro in DeepSeek Harness in under ~3 hours. It has NOT undergone a full code review — only a manual check that the basic functionality works. Understand the security risks and use it at your own discretion before deploying.

Use your **ChatGPT / Codex subscription** (Plus / Pro / Business / Edu) inside dsh (DeepSeek Harness). The plugin signs in to your ChatGPT account through the OpenAI Codex OAuth flow and exposes your subscription quota as the `codex-oauth` model provider.

> ⚠️ **Risk notice**: this plugin calls the ChatGPT web backend (`chatgpt.com/backend-api`), an undocumented, officially unsupported interface. Using it carries a real risk of violating OpenAI's terms of service and may lead to account restrictions. Evaluate it yourself before use.

## Table of contents

- [dsh-llm-codex-oauth](#dsh-llm-codex-oauth)
  - [Table of contents](#table-of-contents)
  - [Features](#features)
  - [Installation](#installation)
    - [One-command install without pnpm (local / development, cross-platform)](#one-command-install-without-pnpm-local--development-cross-platform)
    - [Install Manually](#install-manually)
    - [Verification](#verification)
  - [Usage](#usage)
  - [How it works](#how-it-works)
  - [Development](#development)
  - [Security \& compliance](#security--compliance)
  - [License](#license)

## Features

- **Subscription models**: registers pi-ai's built-in `openai-codex` provider (`openai-codex-responses` wire protocol) as the `codex-oauth` provider on the dsh LLM seam. The model catalog is maintained by the installed pi-ai (e.g. `gpt-5.3-codex-spark`, `gpt-5.4`, `gpt-5.5`, `gpt-5.6-*`, …).
- **OAuth device-code login**: uses `auth.openai.com` (the same OAuth client as the Codex CLI), headless-friendly, no local callback server required.
- **Credential safety**: refresh / access tokens live only in the dsh credential store `$DSH_HOME/.credentials.yaml` (0600) — never in config, never in session logs, never in this repository. Expired access tokens are refreshed automatically by pi-ai inside a serialized write path.
- **Settings-page login**: provides a "Codex 订阅 (ChatGPT)" section with login / logout buttons and live status; the conversation side keeps only the read-only `/codex-status` and `/codex-logout` commands.
- **Multi-turn**: preserves provider-native replay metadata (signatures, …) for reliable multi-turn requests.

## Installation

### One-command install without pnpm (local / development, cross-platform)

If you don't want to install pnpm or hunt for the profile directory, the repo script copies the plugin and registers the bundle for you (Windows / macOS / Linux — just Node, no bash required):

```sh
node scripts/install.mjs            # installs into the web profile by default
node scripts/install.mjs headless   # or another profile name
```

It auto-locates `$DSH_HOME` (default `~/.dsh`), copies the plugin into the `node_modules` location DSH will actually resolve first, and adds the bundle entry — no pnpm involved. On Windows, run the same command in cmd or PowerShell; the plugin itself is pure Node and does not depend on bash or pwsh.

Stop the target dsh process before updating an existing installation, then run the same command again. The script detects both script-managed shared installs and profile-local pnpm installs, stages a rollback-capable replacement beside the target, and removes a duplicate copy that could shadow the refreshed package. OAuth credentials live in `$DSH_HOME/.credentials.yaml`; refreshing the plugin directory does not read, move, or delete them.

The matching uninstall script:

```sh
node scripts/uninstall.mjs            # uninstall from the web profile
node scripts/uninstall.mjs headless   # uninstall from another profile
```

(If you installed via `dsh plugin add` (pnpm), prefer the official `dsh plugin --profile <name> remove dsh-llm-codex-oauth`; the uninstall script also clears the manifest entries as a fallback.)

### Install Manually

```sh
# Prereq 1: pnpm is required (dsh plugin forwards to it). Install first if missing: npm install -g pnpm
# Prereq 2: the dsh CLI is required — either:
#   · install it globally (recommended): npm install -g @deepseek-ai/dsh
#   · or use it ad hoc: replace `dsh` with `npx @deepseek-ai/dsh` below

# With dsh installed globally:
dsh plugin --profile web add file:/path/to/dsh-llm-codex-oauth

# Ad hoc, via npx:
npx @deepseek-ai/dsh plugin --profile web add file:/path/to/dsh-llm-codex-oauth

# restart dsh web so the new bundle takes effect
```

> **The `file:` prefix is required.** Passing a bare directory path makes pnpm install with `link:` (a symlink into this repo),
> and Node's realpath resolution can no longer find the plugin's own `node_modules`, so loading fails.
> `file:` copies the package into the profile's dependency tree (verified).
> pnpm 11's minimum-release-age gate automatically allows this plugin's rc dependencies; no extra configuration needed.
>
> **pnpm 11's ignored-builds notice makes `dsh plugin` report "pnpm failed"** (the packages are actually installed).
> Fix: in the profile's `pnpm-workspace.yaml`, change the `allowBuilds:` placeholders pnpm generated to `false`
> (the `@google/genai` and `protobufjs` build scripts are irrelevant to this plugin), then re-run the same command to finish bundle reconciliation.

### Verification

After installing, `dsh --profile web --dump-config` (or `npx @deepseek-ai/dsh --profile web --dump-config`) should show the `llm-codex-oauth` row.

### HTTP(S) proxy

If ChatGPT works in the browser but device login reports `unsupported_country_region_territory`, the browser may be using a system proxy while the Node.js process running dsh still connects directly. Add a profile override in `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: llm-codex-oauth
  config:
    proxyUrl: http://127.0.0.1:7897
```

Restart `dsh web` to apply it. The plugin proxies only HTTPS requests to `auth.openai.com` and `chatgpt.com`. When enabled, model traffic is forced to SSE so login, token refresh, and inference all use the same HTTP(S) proxy. `http://` and `https://` proxy URLs are supported; SOCKS and PAC are not. Logs omit proxy usernames and passwords.

> Proxy support is intended only to make Node.js use an explicitly configured, policy-compliant network path. It does not bypass OpenAI region or account policy. Use it only from a supported country or territory.

> **Updating plugin code**: a `file:` install is a hard-link snapshot, so an editor's replace-style write is invisible to pnpm and a plain re-`add` may not refresh it. Prefer stopping dsh and running the repository installer; it refreshes the package location that is actually active and does not require repeated version bumps during local iteration:
> ```sh
> node scripts/install.mjs
> ```
> If you use pnpm exclusively, perform a complete remove/add instead:
> ```sh
> dsh plugin --profile web remove dsh-llm-codex-oauth
> dsh plugin --profile web add file:/path/to/dsh-llm-codex-oauth
> # without a global dsh install, replace `dsh` with `npx @deepseek-ai/dsh` above
> ```

## Usage

1. After restarting dsh, open the **settings page** and select "Codex 订阅 (ChatGPT)" in the sidebar.
2. Click "登录 ChatGPT 账号", then follow the prompt: open the verification URL, enter the device code, and sign in to your ChatGPT account.
3. Once the status reads "已连接", switch the model to one under the `codex-oauth` provider on the **Models settings page**.
4. Logout: click "登出" in the settings section, or run `/codex-logout` in the conversation. `/codex-status` shows the current status at any time.

## How it works

| Component | Purpose |
|---|---|
| `src/adapter.js` | `LlmAdapter` implementation: codex stream → dsh `StreamChunk` protocol, signature replay, error classification, idle watchdog |
| `src/store.js` | Bridge between pi-ai's `CredentialStore` and the dsh credential store (serialized read/write, tokens never leave the host) |
| `src/login.js` | Device-code login orchestration (pi-ai's own flow, persists the credential automatically) |
| `src/server.js` | Host `webServer` routes under `/codex-oauth` (status / login / logout) for the browser half |
| `src/client.js` | Browser half: a `settings.section` UI, bundled by `build.mjs` into the client-modules factory format |
| `src/commands.js` | Read-only commands `/codex-status`, `/codex-logout` |

## Development

- Plain ESM JavaScript; the host half needs no build step (named exports `apply` / `inject` / `name`).
- The browser half is bundled with esbuild: `node build.mjs` (React is externalized to `require("react")`, reusing the host's React instance).
- `dsh.bundle.patch` points at `cordis.patch.yml`; `dsh plugin add` adds the plugin to the profile's bundle layer automatically.
- `npm test` verifies repeated installs, profile-local pnpm snapshot refresh, unchanged credentials, and profile-path validation in temporary `DSH_HOME` trees; it needs no network or real credential.
- Tests live in `test/`: `smoke.mjs` (provider route / HTTP endpoints / commands / credential store), `stream-test.mjs` (stream translation, replay, error classification, option assembly, incl. multi-turn replay regressions), `login-smoke.mjs` (live device-flow smoke test, no account involved). They resolve dependencies through the profile's dependency tree; drop them into an installed profile directory and run:
  ```sh
  cp test/*.mjs .testhome/profiles/codex-test2/ && cd .testhome/profiles/codex-test2
  node smoke.mjs && node stream-test.mjs && node login-smoke.mjs
  ```
- Known limitations: image input is not supported yet; the model catalog follows the installed pi-ai version; login state (device code) is process-memory only — after a restart the credential store is the source of truth.

## Security & compliance

- This repository contains no secrets. Before pushing to GitHub (public or private), confirm `.gitignore` is effective and **never** commit `$DSH_HOME/.credentials.yaml` or its contents.
- This plugin uses an undocumented ChatGPT backend interface; there is a risk of violating OpenAI's terms and of account restriction. Use at your own risk.

## License

MIT
