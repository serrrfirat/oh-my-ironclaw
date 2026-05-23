import { SyntaxStyle, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import type { ClientConfig } from "../config"
import { GatewayClient } from "../gateway/client"
import type { ThreadInfo } from "../gateway/types"
import { initialUiState, reduceUiState } from "../state"

type AppProps = {
  config: ClientConfig
}

export function App({ config }: AppProps) {
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()
  const client = useMemo(() => new GatewayClient(config), [config])
  const markdownStyle = useMemo(() => SyntaxStyle.create(), [])
  const textareaRef = useRef<TextareaRenderable>(null)
  const [state, dispatch] = useReducer(reduceUiState, initialUiState)
  const [input, setInput] = useState("")
  const [selectedThreadIndex, setSelectedThreadIndex] = useState(0)

  useKeyboard((key) => {
    if ((key.ctrl && key.name === "c") || key.name === "escape") {
      renderer.destroy()
      return
    }
    if (key.ctrl && key.name === "n") {
      void createThread()
      return
    }
    if (key.ctrl && key.name === "a") {
      void resolveGate("approved")
      return
    }
    if (key.ctrl && key.name === "d") {
      void resolveGate("denied")
      return
    }
    if (key.name === "up") {
      setSelectedThreadIndex((index) => Math.max(0, index - 1))
      return
    }
    if (key.name === "down") {
      setSelectedThreadIndex((index) => Math.min(Math.max(0, state.threads.length - 1), index + 1))
      return
    }
    if (key.name === "return" && key.ctrl) {
      const thread = state.threads[selectedThreadIndex]
      if (thread) void loadThread(thread.id)
    }
  })

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        await client.health()
        dispatch({ type: "connected", connected: true, status: "connected" })
        await refreshThreads()
        if (!cancelled) connectEvents()
      } catch (error) {
        dispatch({ type: "error", message: errorMessage(error) })
      }
    }

    function connectEvents() {
      void (async () => {
        while (!cancelled) {
          try {
            for await (const event of client.events()) {
              if (cancelled) break
              dispatch({ type: "event", event })
            }
          } catch (error) {
            if (!cancelled) {
              dispatch({ type: "connected", connected: false, status: "reconnecting" })
              dispatch({ type: "error", message: errorMessage(error) })
              await sleep(1500)
            }
          }
        }
      })()
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [client])

  async function refreshThreads() {
    const response = await client.threads()
    const threads = [response.assistant_thread, ...response.threads].filter(Boolean) as ThreadInfo[]
    dispatch({ type: "threads", threads, activeThreadId: response.active_thread })
    const threadId = response.active_thread ?? response.assistant_thread?.id ?? response.threads[0]?.id
    if (threadId) await loadThread(threadId)
  }

  async function loadThread(threadId: string) {
    try {
      const history = await client.history(threadId)
      dispatch({ type: "history", history })
      const index = state.threads.findIndex((thread) => thread.id === threadId)
      if (index >= 0) setSelectedThreadIndex(index)
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function createThread() {
    try {
      const thread = await client.newThread()
      dispatch({ type: "threads", threads: [thread, ...state.threads], activeThreadId: thread.id })
      await loadThread(thread.id)
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function submit() {
    const content = input.trim()
    if (!content) return
    setInput("")
    textareaRef.current?.clear()
    dispatch({ type: "user_sent", content, threadId: state.activeThreadId })
    try {
      await client.send(content, state.activeThreadId)
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function resolveGate(resolution: "approved" | "denied") {
    if (!state.pendingGate) return
    try {
      await client.resolveGate({
        request_id: state.pendingGate.request_id,
        thread_id: state.pendingGate.thread_id,
        resolution,
      })
      dispatch({ type: "gate_cleared" })
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  const narrow = width < 105
  const leftWidth = narrow ? 24 : 32
  const rightWidth = narrow ? 0 : 36
  const transcriptHeight = Math.max(8, height - 9)

  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: "#0b0f12" }}>
      <Header connected={state.connected} status={state.status} baseUrl={config.baseUrl} />
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <ThreadList
          threads={state.threads}
          activeThreadId={state.activeThreadId}
          selectedIndex={selectedThreadIndex}
          width={leftWidth}
        />
        <box style={{ flexDirection: "column", flexGrow: 1, minWidth: 35 }}>
          <scrollbox style={{ height: transcriptHeight, flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
            {state.transcript.length === 0 ? (
              <text fg="#7b8794">No messages yet.</text>
            ) : (
              state.transcript.map((item) => (
                <box key={item.id} style={{ flexDirection: "column", marginBottom: 1 }}>
                  <text fg={item.role === "user" ? "#7dd3fc" : item.role === "assistant" ? "#f8fafc" : "#c084fc"}>
                    {item.role}
                  </text>
                  <markdown content={item.text || " "} syntaxStyle={markdownStyle} />
                </box>
              ))
            )}
          </scrollbox>
          {state.pendingGate ? (
            <GatePanel gate={state.pendingGate} />
          ) : (
            <box style={{ height: 1 }}>
              <text fg="#475569">Ctrl+N new thread | Ctrl+Enter open selected thread | Ctrl+C quit</text>
            </box>
          )}
          <box title="Message" style={{ border: true, height: 5, borderColor: "#334155" }}>
            <textarea
              ref={textareaRef}
              focused
              placeholder="Message IronClaw..."
              initialValue=""
              onContentChange={() => setInput(textareaRef.current?.plainText ?? "")}
              onSubmit={submit}
            />
          </box>
        </box>
        {!narrow && <ActivityList width={rightWidth} items={state.activity} />}
      </box>
      {state.lastError ? (
        <box style={{ height: 1, backgroundColor: "#450a0a" }}>
          <text fg="#fecaca">{state.lastError}</text>
        </box>
      ) : null}
    </box>
  )
}

function Header({ connected, status, baseUrl }: { connected: boolean; status: string; baseUrl: string }) {
  return (
    <box style={{ height: 3, border: true, borderColor: connected ? "#14532d" : "#7f1d1d", paddingLeft: 1, paddingRight: 1 }}>
      <text fg="#e2e8f0">
        open_ironclaw <span fg="#64748b">|</span> <span fg={connected ? "#86efac" : "#fca5a5"}>{connected ? "online" : "offline"}</span>{" "}
        <span fg="#64748b">|</span> <span fg="#93c5fd">{status}</span> <span fg="#64748b">| {baseUrl}</span>
      </text>
    </box>
  )
}

function ThreadList({
  threads,
  activeThreadId,
  selectedIndex,
  width,
}: {
  threads: ThreadInfo[]
  activeThreadId?: string | null
  selectedIndex: number
  width: number
}) {
  return (
    <box title="Threads" style={{ border: true, width, borderColor: "#1f2937", flexDirection: "column" }}>
      {threads.slice(0, 24).map((thread, index) => {
        const active = thread.id === activeThreadId
        const selected = index === selectedIndex
        return (
          <box key={thread.id} style={{ height: 2, flexDirection: "column", backgroundColor: selected ? "#172554" : undefined }}>
            <text fg={active ? "#86efac" : "#cbd5e1"}>{truncate(thread.title || thread.thread_type || thread.id, width - 4)}</text>
            <text fg="#64748b">{thread.state} | {thread.turn_count}</text>
          </box>
        )
      })}
    </box>
  )
}

function ActivityList({ width, items }: { width: number; items: Array<{ id: string; label: string; detail?: string; status: string }> }) {
  return (
    <box title="Activity" style={{ border: true, width, borderColor: "#1f2937", flexDirection: "column" }}>
      {items.slice(-30).map((item) => (
        <box key={item.id} style={{ flexDirection: "column", marginBottom: 1 }}>
          <text fg={item.status === "error" ? "#fca5a5" : item.status === "ok" ? "#86efac" : item.status === "running" ? "#facc15" : "#93c5fd"}>
            {truncate(item.label, width - 4)}
          </text>
          {item.detail ? <text fg="#94a3b8">{truncate(item.detail, width - 4)}</text> : null}
        </box>
      ))}
    </box>
  )
}

function GatePanel({ gate }: { gate: { tool_name: string; description: string; parameters: string } }) {
  return (
    <box style={{ border: true, height: 6, borderColor: "#a16207", flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}>
      <text fg="#fde68a">Approval required: {gate.tool_name}</text>
      <text fg="#e5e7eb">{truncate(gate.description, 100)}</text>
      <text fg="#94a3b8">{truncate(gate.parameters, 100)}</text>
      <text fg="#facc15">Ctrl+A approve | Ctrl+D deny</text>
    </box>
  )
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 3))}...`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
