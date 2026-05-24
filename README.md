# oh-my-ironclaw

OpenTUI client for the IronClaw Reborn gateway API.

## Run

Start an IronClaw reborn/gateway binary first, then run:

```bash
OPEN_IRONCLAW_URL=http://127.0.0.1:3000 \
OPEN_IRONCLAW_TOKEN=your-token \
bun run dev
```

Use `/model` or `ctrl+m` to ask Reborn for the active model and available models. Selecting a model sends `/model <name>` through the same WebChat v2 message workflow, so the server-side command persists or applies the model choice.

The command palette (`ctrl+p`) submits Reborn slash commands as literal commands instead of rewriting them into chat prompts. Commands that need arguments, such as `/skills search`, `/cancel`, `/plan`, and `/thread`, are inserted into the composer for completion. `/threads`, `/history`, and `/run-cancel` are local TUI controls for the WebChat surface.

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
bun run dev -- --url http://127.0.0.1:3000 --token your-token --models GPT-5.5,gpt-5.3-codex --model GPT-5.5 --debug-events
```
