# oh-my-ironclaw

OpenTUI client for the IronClaw Reborn gateway API.

## Run

Start an IronClaw reborn/gateway binary first, then run:

```bash
OPEN_IRONCLAW_URL=http://127.0.0.1:3000 \
OPEN_IRONCLAW_TOKEN=your-token \
bun run dev
```

The client uses the same gateway contract as the web UI:

- `POST /api/chat/send`
- `GET /api/chat/events?token=...`
- `GET /api/chat/history`
- `GET /api/chat/threads`
- `POST /api/chat/thread/new`
- `POST /api/chat/gate/resolve`
- `GET /api/gateway/status`

CLI flags are also supported:

```bash
bun run dev -- --url http://127.0.0.1:3000 --token your-token --debug-events
```
