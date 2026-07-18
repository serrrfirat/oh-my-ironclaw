# oh-my-ironclaw

<img width="1325" height="760" alt="oh-my-ironclaw screenshot" src="https://github.com/user-attachments/assets/e52a8757-cf20-4a1e-80dd-47121d2ad8a5" />

OpenTUI client for the IronClaw Reborn WebChat v2/Product Workflow API.

The TUI is a separate client. Start an IronClaw Reborn server first, then run this app against that server.

## Requirements

- Bun
- An IronClaw Reborn checkout or installed `ironclaw`/`ironclaw-reborn` binary
- A WebChat v2 server token shared by the server and this client

## Start Reborn

From an IronClaw Reborn source checkout:

```bash
IRONCLAW_REBORN_WEBUI_TOKEN=local-dev-token \
IRONCLAW_REBORN_WEBUI_USER_ID=local-user \
cargo run -p ironclaw \
  --features webui-v2-beta \
  --bin ironclaw \
  -- serve --host 127.0.0.1 --port 3000
```

The TUI uses `OPEN_IRONCLAW_TOKEN` first, then falls back to `IRONCLAW_REBORN_WEBUI_TOKEN`. The value must match the server token.

## Run The TUI

Install dependencies once:

```bash
bun install
```

Remote mode is the default. It talks only to the WebChat v2/Product Workflow API and does not execute local commands:

```bash
OPEN_IRONCLAW_URL=http://127.0.0.1:3000 \
OPEN_IRONCLAW_TOKEN=local-dev-token \
bun run dev
```

Local mode still sends chat through WebChat v2, but also enables read-only CLI-backed commands on the machine running the TUI:

```bash
OPEN_IRONCLAW_MODE=local \
OPEN_IRONCLAW_URL=http://127.0.0.1:3000 \
OPEN_IRONCLAW_TOKEN=local-dev-token \
OPEN_IRONCLAW_REBORN_BIN=ironclaw-reborn \
bun run dev
```

If the Reborn CLI is not on `$PATH`, point the TUI at the source checkout instead:

```bash
OPEN_IRONCLAW_MODE=local \
OPEN_IRONCLAW_URL=http://127.0.0.1:3000 \
OPEN_IRONCLAW_TOKEN=local-dev-token \
OPEN_IRONCLAW_REBORN_SOURCE=/Users/firatsertgoz/.codex/worktrees/6e9e/ironclaw \
OPEN_IRONCLAW_REBORN_FEATURES=webui-v2-beta \
bun run dev
```

With `OPEN_IRONCLAW_REBORN_SOURCE` set, local commands run as:

```bash
cargo run -p ironclaw --features "$OPEN_IRONCLAW_REBORN_FEATURES" --bin ironclaw -- <command>
```

If `OPEN_IRONCLAW_REBORN_FEATURES` is unset, the `--features` argument is omitted.

## Commands

The command palette opens with `ctrl+p`. Typing `/` also opens filtered slash commands.

Remote/Product Workflow commands:

- `/model` — show or switch the active model; `/model set-provider <p> [--model m]` is passed through to the server
- `/models`
- `/skills` — opens the WebChat v2 skills surface (install / search / view / remove, per-skill and learned auto-activate)
- `/extension`
- `/status`
- `/progress`

Remote observability, files, and delivery surfaces:

- `/logs` — remote log viewer with level/target/thread filters, follow toggle, and pagination
- `/traces` — trace credit, holds (authorize), and account login link
- `/workspace` (alias `/files`) — read-only filesystem mount browser
- `/projects` — projects list/create/members/delete (requires the `reborn_projects` feature)
- `/tools` — per-tool permission cycling + global auto-approve, plus session info
- `/outbound` — delivery defaults (final-reply target, default modality)

Chat/run controls:

- `/inbox` — jump to the next thread needing approval
- `/retry` — retry the last failed or cancelled run
- `/delete-thread` — delete the active thread
- `/attach <path>` — stage a local file as an attachment for the next message
- `/save <n>` — save the nth attachment of the latest message to the working directory

In local mode, `/skills` opens a searchable TUI skill catalog backed by `ironclaw-reborn skills list --json --verbose`, and `/extension` searches local Reborn extensions. In remote mode, `/skills` opens the HTTP-backed skills surface and server slash names such as `/skill_*` and `/extension_*` are passed through as messages.

Local mode adds read-only CLI commands:

- `/doctor`
- `/profile`
- `/channels`
- `/hooks`
- `/model-status`
- `/logs` (local CLI; remote mode opens the log surface instead)
- `/logs-json`
- `/config-path`
- `/traces-status`
- `/traces-queue`
- `/traces-credit`

TUI-only controls:

- `/new`
- `/settings`
- `/automations` — pause / resume / rename / delete schedules
- `/channels`
- `/threads`
- `/history`
- `/run-cancel`
- `/quit`

`/model`, `/models`, and `ctrl+m` open the model picker. The picker is seeded from config, then updated from the server response. Selecting a model sends `/model <name>` through WebChat v2 so the server-side command applies the choice.

The settings surface is functional: the **Tools** section cycles per-tool permissions (`default → always_allow → ask_each_time → disabled`) and toggles global auto-approve, persisting each change via `/settings/tools`; the **Outbound** section selects the final-reply delivery target; **Skills**, **Automations**, **Extensions**, **Channels**, and **Providers** open their live surfaces. LLM providers are gated on the operator capability from `GET /session`.

## Keys

- `enter`: send the current message or run the selected palette item
- `esc`: close an open palette / back out a sub-mode; otherwise cancel the active run
- `ctrl+p`: command palette
- `ctrl+t`: thread picker (`ctrl+d` deletes the selected thread with a `y`/`n` confirm)
- `ctrl+m`: model picker
- `ctrl+n`: new thread
- `ctrl+x`: cancel active run
- `ctrl+r`: retry the last failed/cancelled run
- `ctrl+g`: jump to the next thread awaiting approval
- `pageup` or `/history`: load older timeline messages
- `ctrl+a`: approve a pending gate
- `ctrl+d`: deny a pending gate
- `w`: approve-always on a gate that allows it
- `ctrl+c`: quit

Surface-local keys are shown in each surface's footer hint (e.g. logs: `l` level · `t` target · `f` follow · `o` older; tools: `enter` cycle · `g` global auto-approve; automations: `p`/`r`/`n`/`d`; workspace: `enter` descend · `backspace` up).

## Design

The UI uses the **IronClaw DS (PR #5563) "Pixel" theme** — a flat `#09090b` canvas with hairline separators, square uppercase tag chips, a signal-blue accent ramp (`#2882c8 → #4ca7e6 → #6bb8ec`), and a strict status canon (running = info blue, success = ok green, approval/attention = warn amber, failure/cancelled = danger red, paused/idle = muted). All tokens live in `src/ui/theme.ts`; surfaces import from it rather than hard-coding colors. The LocalDevYolo rainbow splash variant is preserved.

## Configuration

| Environment | Flag | Default | Purpose |
| --- | --- | --- | --- |
| `OPEN_IRONCLAW_MODE` | `--mode` | `remote` | `remote` or `local` |
| `OPEN_IRONCLAW_URL` | `--url` | `http://127.0.0.1:3000` | Reborn WebChat v2 base URL |
| `OPEN_IRONCLAW_TOKEN` | `--token` | empty | Bearer token for the Reborn server |
| `OPEN_IRONCLAW_REBORN_BIN` | `--reborn-bin` | `ironclaw-reborn` | Binary used for local CLI commands |
| `OPEN_IRONCLAW_REBORN_SOURCE` | `--reborn-source` | unset | Source checkout used for local CLI commands |
| `OPEN_IRONCLAW_REBORN_FEATURES` | `--reborn-features` | unset | Cargo features when running from source |
| `OPEN_IRONCLAW_MODEL` | `--model` | `GPT-5.5` | Initial selected model |
| `OPEN_IRONCLAW_MODELS` | `--models` | unset | Comma-separated initial model list |
| `OPEN_IRONCLAW_DEBUG` | `--debug-events` | unset | Enable debug event mode |

`OPEN_IRONCLAW_URL` also falls back to `IRONCLAW_REBORN_WEBUI_URL`. `OPEN_IRONCLAW_TOKEN` also falls back to `IRONCLAW_REBORN_WEBUI_TOKEN`.

Example with flags:

```bash
bun run dev -- \
  --mode local \
  --url http://127.0.0.1:3000 \
  --token local-dev-token \
  --reborn-source /Users/firatsertgoz/.codex/worktrees/6e9e/ironclaw \
  --reborn-features webui-v2-beta \
  --models GPT-5.5,gpt-5.3-codex \
  --model GPT-5.5 \
  --debug-events
```

## WebChat v2 Contract

The client currently uses:

- `GET /api/webchat/v2/session` (features, attachment budgets, operator capability)
- `POST` / `GET` / `DELETE /api/webchat/v2/threads` (and `?needs_approval=true` for the approval-inbox badge)
- `POST /api/webchat/v2/threads/{thread_id}/messages` (with `attachments`)
- `GET .../threads/{thread_id}/timeline`, `GET .../events` (SSE with resume + `cancelled`)
- `POST .../runs/{run_id}/cancel`, `POST .../runs/{run_id}/retry`
- `POST .../runs/{run_id}/gates/{gate_ref}/resolve` (approve / deny / always / credential)
- `GET .../messages/{message_id}/attachments/{attachment_id}` (save-to-file)
- `GET/POST /skills*`, `GET/POST /settings/tools`, `POST /automations/{id}/{pause,resume}` + rename/delete
- `GET/POST /outbound/preferences`, `GET /outbound/targets`
- `GET /logs`, `GET /traces/*`, `GET /fs/*`, `GET/POST/DELETE /projects*`

Mapped SSE events include `running`, `capability_progress`, `capability_activity`, `gate`, `auth_required`, `final_reply`, `failed`, `cancelled`, `projection_snapshot`, and `projection_update`. `rejected_busy` message submissions surface a dim notice (not an error), and per-run token usage/cost appears in the status bar.

`capability_activity` is rendered as a tool/activity row, but it is metadata-only: invocation id, capability id, status, provider/runtime/process metadata, output byte count, and safe error kind. Full tool input/output previews require a separate server-side display-preview event before the TUI can render expandable tool output.

## LocalDevYolo Splash

In local mode the TUI asks the CLI for `profile list --json`. If the active profile looks like LocalDevYolo, the splash logo switches to the animated rainbow variant with the small `yolo` mark.

## Development

```bash
bun run typecheck
bun test
bun run check
```

## Troubleshooting

- `offline | error`: confirm the Reborn server is listening on `OPEN_IRONCLAW_URL` and the token matches `IRONCLAW_REBORN_WEBUI_TOKEN`.
- `Executable not found`: set `OPEN_IRONCLAW_REBORN_BIN` to an installed binary, or use `OPEN_IRONCLAW_REBORN_SOURCE`.
- Source CLI commands fail: confirm the source checkout is on the right Reborn branch and, when needed, set `OPEN_IRONCLAW_REBORN_FEATURES=webui-v2-beta`.
- `/models` only shows the current model: the server did not return an available model list, so the picker falls back to the active model.
