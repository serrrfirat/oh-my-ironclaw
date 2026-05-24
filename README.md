# oh-my-ironclaw

OpenTUI client for the IronClaw Reborn gateway API.

## Run

Start an IronClaw reborn/gateway binary first, then run:

```bash
OPEN_IRONCLAW_URL=http://127.0.0.1:3000 \
OPEN_IRONCLAW_TOKEN=your-token \
OPEN_IRONCLAW_MODELS=GPT-5.5,gpt-5.3-codex \
bun run dev
```

Use `/model` or `ctrl+m` to choose one of the comma-separated model labels. This is currently a TUI-local selection because the Reborn WebChat v2 API does not expose model listing or per-turn model routing yet.

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
