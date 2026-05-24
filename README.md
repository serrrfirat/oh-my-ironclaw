# oh-my-ironclaw

OpenTUI client for the IronClaw Reborn gateway API.

## Run

Start an IronClaw reborn/gateway binary first, then run in remote mode:

```bash
OPEN_IRONCLAW_MODE=remote \
OPEN_IRONCLAW_URL=http://127.0.0.1:3000 \
OPEN_IRONCLAW_TOKEN=your-token \
bun run dev
```

Remote mode talks only to the WebChat v2/Product Workflow API. Use it when the TUI is pointed at a remote or local Reborn server and should not execute any local machine commands.

Local mode still sends chat through WebChat v2, but also enables local read-only CLI-backed commands:

- `/doctor`
- `/profile`
- `/skills`
- `/channels`
- `/hooks`
- `/models`
- `/model-status`
- `/logs`
- `/logs-json`
- `/config-path`
- `/traces-status`
- `/traces-queue`
- `/traces-credit`

```bash
OPEN_IRONCLAW_MODE=local \
OPEN_IRONCLAW_URL=http://127.0.0.1:3000 \
OPEN_IRONCLAW_TOKEN=your-token \
OPEN_IRONCLAW_REBORN_BIN=ironclaw-reborn \
bun run dev
```

If you run IronClaw from source and do not have `ironclaw-reborn` installed on `$PATH`, point the TUI at the source checkout instead:

```bash
OPEN_IRONCLAW_MODE=local \
OPEN_IRONCLAW_URL=http://127.0.0.1:3000 \
OPEN_IRONCLAW_TOKEN=your-token \
OPEN_IRONCLAW_REBORN_SOURCE=/Users/firatsertgoz/.codex/worktrees/bb76/ironclaw \
bun run dev
```

With `OPEN_IRONCLAW_REBORN_SOURCE` set, local CLI commands run as:

```bash
cargo run -p ironclaw_reborn_cli --features webui-v2-beta --bin ironclaw-reborn -- <command>
```

Use `/model` or `ctrl+m` to ask Reborn for the active model and available models. Selecting a model sends `/model <name>` through the same WebChat v2 message workflow, so the server-side command persists or applies the model choice.

The command palette (`ctrl+p`) always includes the Reborn product workflow slash commands that exist today as literal remote commands: `/model`, `/status`, and `/progress`. In local mode it also includes read-only CLI commands that run on the same machine as the TUI. `/threads`, `/history`, `/run-cancel`, and `/quit` are local TUI controls for the WebChat surface.

You can still seed the picker before the first server response:

```bash
OPEN_IRONCLAW_MODELS=GPT-5.5,gpt-5.3-codex \
OPEN_IRONCLAW_MODEL=GPT-5.5 \
bun run dev
```

The client uses the Reborn WebChat v2 gateway contract:

- `POST /api/webchat/v2/threads`
- `GET /api/webchat/v2/threads`
- `POST /api/webchat/v2/threads/{thread_id}/messages`
- `GET /api/webchat/v2/threads/{thread_id}/timeline`
- `GET /api/webchat/v2/threads/{thread_id}/events`
- `POST /api/webchat/v2/threads/{thread_id}/runs/{run_id}/cancel`
- `POST /api/webchat/v2/threads/{thread_id}/runs/{run_id}/gates/{gate_ref}/resolve`

CLI flags are also supported:

```bash
bun run dev -- --mode local --url http://127.0.0.1:3000 --token your-token --reborn-source /Users/firatsertgoz/.codex/worktrees/bb76/ironclaw --models GPT-5.5,gpt-5.3-codex --model GPT-5.5 --debug-events
```
