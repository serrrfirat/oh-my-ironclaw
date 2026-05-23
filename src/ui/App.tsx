import { SyntaxStyle, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useEffect, useMemo, useReducer, useRef, useState, type RefObject } from "react"
import type { ClientConfig } from "../config"
import { GatewayClient } from "../gateway/client"
import type { PendingGateInfo, ThreadInfo } from "../gateway/types"
import { initialUiState, reduceUiState } from "../state"

type AppProps = {
  config: ClientConfig
}

type GateAction = "approved" | "denied"

export function App({ config }: AppProps) {
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()
  const client = useMemo(() => new GatewayClient(config), [config])
  const markdownStyle = useMemo(() => SyntaxStyle.create(), [])
  const textareaRef = useRef<TextareaRenderable>(null)
  const [state, dispatch] = useReducer(reduceUiState, initialUiState)
  const [input, setInput] = useState("")
  const [selectedThreadIndex, setSelectedThreadIndex] = useState(0)
  const [selectedGateAction, setSelectedGateAction] = useState<GateAction>("approved")

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
    if (state.pendingGate) {
      if (key.name === "left" || key.name === "right" || key.name === "tab") {
        setSelectedGateAction((action) => (action === "approved" ? "denied" : "approved"))
        return
      }
      if (key.name === "return" || key.name === "kpenter" || key.name === "linefeed") {
        void resolveGate(selectedGateAction)
        return
      }
    }
    if (isPlainEnter(key)) {
      key.preventDefault()
      key.stopPropagation()
      void submit()
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
    if (state.pendingGate) {
      setSelectedGateAction("approved")
    }
  }, [state.pendingGate?.request_id])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        await client.health()
        dispatch({ type: "connected", connected: true, status: "connected" })
        const threadId = await refreshThreads()
        if (!cancelled && threadId) connectEvents(threadId)
      } catch (error) {
        dispatch({ type: "error", message: errorMessage(error) })
      }
    }

    function connectEvents(threadId: string) {
      void (async () => {
        while (!cancelled) {
          try {
            for await (const event of client.events(threadId)) {
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

  async function refreshThreads(): Promise<string | null> {
    const response = await client.threads()
    let threads = [response.assistant_thread, ...response.threads].filter(Boolean) as ThreadInfo[]
    let threadId = response.active_thread ?? response.assistant_thread?.id ?? response.threads[0]?.id ?? null

    if (!threadId) {
      const thread = await client.newThread()
      threads = [thread]
      threadId = thread.id
    }

    dispatch({ type: "threads", threads, activeThreadId: threadId })
    if (threadId) await loadThread(threadId)
    return threadId
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
      const response = await client.send(content, state.activeThreadId)
      if (response.thread_id && response.thread_id !== state.activeThreadId) {
        dispatch({ type: "threads", threads: state.threads, activeThreadId: response.thread_id })
        void loadThread(response.thread_id)
      }
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
        run_id: state.pendingGate.run_id,
        gate_ref: state.pendingGate.gate_ref,
        resolution,
      })
      dispatch({ type: "gate_cleared" })
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  const hasConversation = state.transcript.length > 0 || Boolean(state.pendingGate)
  const composerWidth = clamp(width - 8, 42, 82)
  const contentWidth = clamp(width - 8, 48, 100)

  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: "#050505" }}>
      {hasConversation ? (
        <ConversationSurface
          contentWidth={contentWidth}
          composerWidth={composerWidth}
          height={height}
          inputRef={textareaRef}
          lastError={state.lastError}
          markdownStyle={markdownStyle}
          pendingGate={state.pendingGate ?? null}
          selectedGateAction={selectedGateAction}
          transcript={state.transcript}
          onInputChange={() => setInput(textareaRef.current?.plainText ?? "")}
          onResolve={(action) => void resolveGate(action)}
          onSelectGateAction={setSelectedGateAction}
          onSubmit={submit}
        />
      ) : (
        <WelcomeSurface
          baseUrl={config.baseUrl}
          composerWidth={composerWidth}
          connected={state.connected}
          height={height}
          inputRef={textareaRef}
          lastError={state.lastError}
          status={state.status}
          width={width}
          onInputChange={() => setInput(textareaRef.current?.plainText ?? "")}
          onSubmit={submit}
        />
      )}
    </box>
  )
}

function WelcomeSurface({
  baseUrl,
  composerWidth,
  connected,
  height,
  inputRef,
  lastError,
  status,
  width,
  onInputChange,
  onSubmit,
}: {
  baseUrl: string
  composerWidth: number
  connected: boolean
  height: number
  inputRef: RefObject<TextareaRenderable | null>
  lastError?: string | null
  status: string
  width: number
  onInputChange: () => void
  onSubmit: () => void
}) {
  const topSpacer = Math.max(1, Math.floor(height * 0.32) - 5)
  return (
    <box style={{ width, height, flexDirection: "column", alignItems: "center", backgroundColor: "#050505" }}>
      <box style={{ height: topSpacer }} />
      {height >= 15 ? (
        <ascii-font text="ironclaw" font="block" color={["#0f7a3a", "#8cffb0"]} backgroundColor="#050505" />
      ) : (
        <text fg="#8cffb0">ironclaw</text>
      )}
      <box style={{ height: 2 }} />
      <Composer
        focused
        inputRef={inputRef}
        width={composerWidth}
        onInputChange={onInputChange}
        onSubmit={onSubmit}
      />
      <HintLine width={composerWidth} />
      <box style={{ height: 3 }} />
      <text fg="#777777">
        <span fg="#f6ad3c">* Tip</span> Press <span fg="#cfcfcf">ctrl+z</span> to suspend the terminal and return to your shell
      </text>
      {lastError ? (
        <box style={{ height: 1, width: composerWidth }}>
          <text fg="#696969">
            {connected ? "online" : "offline"} | {status} | {truncate(baseUrl, Math.max(0, composerWidth - 18))}
          </text>
        </box>
      ) : null}
    </box>
  )
}

function ConversationSurface({
  composerWidth,
  contentWidth,
  height,
  inputRef,
  lastError,
  markdownStyle,
  pendingGate,
  selectedGateAction,
  transcript,
  onInputChange,
  onResolve,
  onSelectGateAction,
  onSubmit,
}: {
  composerWidth: number
  contentWidth: number
  height: number
  inputRef: RefObject<TextareaRenderable | null>
  lastError?: string | null
  markdownStyle: SyntaxStyle
  pendingGate: PendingGateInfo | null
  selectedGateAction: GateAction
  transcript: Array<{ id: string; role: string; text: string }>
  onInputChange: () => void
  onResolve: (action: GateAction) => void
  onSelectGateAction: (action: GateAction) => void
  onSubmit: () => void
}) {
  const transcriptHeight = Math.max(6, height - (pendingGate ? 16 : 10))

  return (
    <box style={{ height, flexDirection: "column", alignItems: "center", backgroundColor: "#050505", paddingTop: 1 }}>
      <box style={{ width: contentWidth, height: 1, flexDirection: "row" }}>
        <text fg="#8cffb0">ironclaw</text>
        <text fg="#4c4c4c"> | </text>
        <text fg="#2ee66b">build</text>
      </box>
      <scrollbox style={{ width: contentWidth, height: transcriptHeight, paddingTop: 1, paddingBottom: 1 }}>
        {transcript.map((item) => (
          <box key={item.id} style={{ flexDirection: "column", marginBottom: 1 }}>
            <text fg={item.role === "user" ? "#2ee66b" : item.role === "assistant" ? "#e6edf3" : "#d29922"}>
              {item.role}
            </text>
            <markdown content={item.text || " "} syntaxStyle={markdownStyle} />
          </box>
        ))}
      </scrollbox>
      {pendingGate ? (
        <GatePanel
          gate={pendingGate}
          selectedAction={selectedGateAction}
          width={composerWidth}
          onSelect={onSelectGateAction}
          onResolve={onResolve}
        />
      ) : (
        <box style={{ width: composerWidth, height: 1 }}>
          <text fg="#606060">ctrl+n new thread  |  ctrl+c quit</text>
        </box>
      )}
      <Composer
        focused={!pendingGate}
        inputRef={inputRef}
        width={composerWidth}
        onInputChange={onInputChange}
        onSubmit={onSubmit}
      />
      {lastError ? <StatusLine connected={false} status="error" message={lastError} width={composerWidth} /> : null}
    </box>
  )
}

function Composer({
  focused,
  inputRef,
  width,
  onInputChange,
  onSubmit,
}: {
  focused: boolean
  inputRef: RefObject<TextareaRenderable | null>
  width: number
  onInputChange: () => void
  onSubmit: () => void
}) {
  return (
    <box style={{ width, height: 6, flexDirection: "row", backgroundColor: "#1f1f1f" }}>
      <box style={{ width: 1, backgroundColor: "#00d26a" }} />
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
        <textarea
          ref={inputRef}
          focused={focused}
          placeholder={'Ask anything... "What is the tech stack of this project?"'}
          initialValue=""
          backgroundColor="#1f1f1f"
          focusedBackgroundColor="#1f1f1f"
          textColor="#d9d9d9"
          focusedTextColor="#f2f2f2"
          placeholderColor="#8a8a8a"
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "kpenter", action: "submit" },
            { name: "linefeed", action: "submit" },
            { name: "return", shift: true, action: "newline" },
            { name: "kpenter", shift: true, action: "newline" },
          ]}
          onContentChange={onInputChange}
          onSubmit={onSubmit}
          style={{ height: 3 }}
        />
        <box style={{ height: 1, flexDirection: "row" }}>
          <text fg="#2ee66b">Build</text>
          <text fg="#777777"> . </text>
          <text fg="#d0d0d0">GPT-5.5</text>
          <text fg="#858585"> OpenAI</text>
        </box>
      </box>
    </box>
  )
}

function HintLine({ width }: { width: number }) {
  return (
    <box style={{ width, height: 1, flexDirection: "row", justifyContent: "flex-end" }}>
      <text fg="#cfcfcf">tab</text>
      <text fg="#777777"> agents   </text>
      <text fg="#cfcfcf">ctrl+p</text>
      <text fg="#777777"> commands</text>
    </box>
  )
}

function StatusLine({
  baseUrl,
  connected,
  message,
  status,
  width,
}: {
  baseUrl?: string
  connected: boolean
  message: string
  status: string
  width: number
}) {
  return (
    <box style={{ width, height: 2, flexDirection: "column" }}>
      <text fg={connected ? "#8fd694" : "#f08a8a"}>{connected ? "online" : "offline"} | {status}</text>
      <text fg="#777777">{truncate(baseUrl ? `${message} | ${baseUrl}` : message, width)}</text>
    </box>
  )
}

function GatePanel({
  gate,
  selectedAction,
  width,
  onSelect,
  onResolve,
}: {
  gate: PendingGateInfo
  selectedAction: GateAction
  width: number
  onSelect: (action: GateAction) => void
  onResolve: (action: GateAction) => void
}) {
  return (
    <box
      focused
      style={{ width, height: 8, backgroundColor: "#181818", flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}
    >
      <text fg="#f0b45f">Approval required: {gate.tool_name}</text>
      <text fg="#d7d7d7">{truncate(gate.description, width - 6)}</text>
      <text fg="#858585">{truncate(gate.parameters, width - 6)}</text>
      <box style={{ flexDirection: "row", height: 3, marginTop: 1 }}>
        <GateButton
          label="Approve"
          action="approved"
          selected={selectedAction === "approved"}
          onSelect={onSelect}
          onResolve={onResolve}
        />
        <box style={{ width: 2 }} />
        <GateButton
          label="Deny"
          action="denied"
          selected={selectedAction === "denied"}
          onSelect={onSelect}
          onResolve={onResolve}
        />
        <text fg="#777777">  left/right select, enter activate</text>
      </box>
    </box>
  )
}

function GateButton({
  label,
  action,
  selected,
  onSelect,
  onResolve,
}: {
  label: string
  action: GateAction
  selected: boolean
  onSelect: (action: GateAction) => void
  onResolve: (action: GateAction) => void
}) {
  const isApprove = action === "approved"
  const backgroundColor = selected ? (isApprove ? "#12351f" : "#3a1616") : "#242424"
  const borderColor = selected ? (isApprove ? "#2ea043" : "#f85149") : "#3d3d3d"
  const textColor = selected ? "#f5f5f5" : isApprove ? "#8fd694" : "#f08a8a"

  return (
    <box
      focusable
      onMouseOver={() => onSelect(action)}
      onMouseDown={() => onSelect(action)}
      onMouseUp={() => onResolve(action)}
      style={{
        border: true,
        borderColor,
        backgroundColor,
        width: 14,
        height: 3,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <text fg={textColor}>{selected ? "> " : "  "}{label}{selected ? " <" : "  "}</text>
    </box>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 3))}...`
}

function isPlainEnter(key: {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  option: boolean
  super?: boolean
  hyper?: boolean
}): boolean {
  return (
    (key.name === "return" || key.name === "kpenter" || key.name === "linefeed") &&
    !key.ctrl &&
    !key.meta &&
    !key.shift &&
    !key.option &&
    !key.super &&
    !key.hyper
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
