import { SyntaxStyle, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useEffect, useMemo, useReducer, useRef, useState, type RefObject } from "react"
import type { ClientConfig } from "../config"
import { GatewayClient } from "../gateway/client"
import type { AppEvent, PendingGateInfo, ThreadInfo } from "../gateway/types"
import { initialUiState, reduceUiState } from "../state"

type AppProps = {
  config: ClientConfig
}

type GateAction = "approved" | "denied"
type SlashCommandAction = "new-thread" | "clear-input"
type SlashCommand = {
  name: string
  description: string
  prompt?: string
  action?: SlashCommandAction
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help", description: "Ask IronClaw what it can do", prompt: "What can you help me with in this project?" },
  { name: "/skills", description: "List available skills and tools", prompt: "List all available skills and tools." },
  { name: "/status", description: "Ask for runtime and model status", prompt: "Check the current runtime and model status. Summarize any active issues." },
  { name: "/new", description: "Start a new thread", action: "new-thread" },
  { name: "/clear", description: "Clear the composer", action: "clear-input" },
]

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
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const activityFrame = useActivityFrame(state.isThinking)
  const slashCommands = filteredSlashCommands(input)
  const showSlashCommands = isSlashCommandInput(input) && slashCommands.length > 0

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }
    if (key.name === "escape") {
      if (showSlashCommands) {
        key.preventDefault()
        key.stopPropagation()
        setInput("")
        textareaRef.current?.clear()
        return
      }
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
    if (showSlashCommands) {
      if (key.name === "up") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedCommandIndex((index) => wrapIndex(index - 1, slashCommands.length))
        return
      }
      if (key.name === "down" || key.name === "tab") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedCommandIndex((index) => wrapIndex(index + 1, slashCommands.length))
        return
      }
      if (isPlainEnter(key)) {
        key.preventDefault()
        key.stopPropagation()
        void runSlashCommand(slashCommands[selectedCommandIndex] ?? slashCommands[0])
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
    setSelectedCommandIndex(0)
  }, [slashCommandQuery(input)])

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
              if (isTerminalRunStatusEvent(event)) void refreshThreadFromEvent(event.thread_id)
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
    await submitContent(content)
  }

  async function submitContent(content: string) {
    const previousAssistantCount = state.transcript.filter((item) => item.role === "assistant").length
    setInput("")
    textareaRef.current?.clear()
    dispatch({ type: "user_sent", content, threadId: state.activeThreadId })
    try {
      const response = await client.send(content, state.activeThreadId)
      const threadId = response.thread_id ?? state.activeThreadId
      if (threadId && threadId !== state.activeThreadId) {
        dispatch({ type: "threads", threads: state.threads, activeThreadId: threadId })
      }
      if (threadId) void pollThreadForReply(threadId, previousAssistantCount)
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function runSlashCommand(command: SlashCommand | undefined) {
    if (!command) return
    if (command.action === "clear-input") {
      setInput("")
      textareaRef.current?.clear()
      return
    }
    if (command.action === "new-thread") {
      setInput("")
      textareaRef.current?.clear()
      await createThread()
      return
    }
    if (command.prompt) {
      await submitContent(command.prompt)
    }
  }

  async function pollThreadForReply(threadId: string, previousAssistantCount: number) {
    for (const delay of [750, 1250, 2000, 3000, 5000, 8000, 12000]) {
      await sleep(delay)
      try {
        const history = await client.history(threadId)
        dispatch({ type: "history", history })
        const assistantCount = history.turns.filter((turn) => turn.response).length
        if (assistantCount > previousAssistantCount || history.pending_gate) return
      } catch (error) {
        dispatch({ type: "error", message: errorMessage(error) })
        return
      }
    }
  }

  async function refreshThreadFromEvent(threadId?: string | null) {
    if (!threadId) return
    await sleep(150)
    await loadThread(threadId)
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
  const conversationWidth = Math.max(1, width - 4)

  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: "#050505" }}>
      {hasConversation ? (
        <ConversationSurface
          contentWidth={conversationWidth}
          composerWidth={conversationWidth}
          height={height}
          inputRef={textareaRef}
          isThinking={state.isThinking}
          lastError={state.lastError}
          markdownStyle={markdownStyle}
          pendingGate={state.pendingGate ?? null}
          railColor={activityFrame.railColor}
          selectedGateAction={selectedGateAction}
          selectedSlashCommandIndex={wrapIndex(selectedCommandIndex, slashCommands.length)}
          showSlashCommands={showSlashCommands}
          slashCommands={slashCommands}
          spinner={activityFrame.spinner}
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
          isThinking={state.isThinking}
          lastError={state.lastError}
          railColor={activityFrame.railColor}
          selectedSlashCommandIndex={wrapIndex(selectedCommandIndex, slashCommands.length)}
          showSlashCommands={showSlashCommands}
          slashCommands={slashCommands}
          spinner={activityFrame.spinner}
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
  isThinking,
  lastError,
  railColor,
  selectedSlashCommandIndex,
  showSlashCommands,
  slashCommands,
  spinner,
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
  isThinking: boolean
  lastError?: string | null
  railColor: string
  selectedSlashCommandIndex: number
  showSlashCommands: boolean
  slashCommands: SlashCommand[]
  spinner: string
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
        isThinking={isThinking}
        railColor={railColor}
        selectedSlashCommandIndex={selectedSlashCommandIndex}
        showSlashCommands={showSlashCommands}
        slashCommands={slashCommands}
        spinner={spinner}
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
  isThinking,
  lastError,
  markdownStyle,
  pendingGate,
  railColor,
  selectedGateAction,
  selectedSlashCommandIndex,
  showSlashCommands,
  slashCommands,
  spinner,
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
  isThinking: boolean
  lastError?: string | null
  markdownStyle: SyntaxStyle
  pendingGate: PendingGateInfo | null
  railColor: string
  selectedGateAction: GateAction
  selectedSlashCommandIndex: number
  showSlashCommands: boolean
  slashCommands: SlashCommand[]
  spinner: string
  transcript: Array<{ id: string; role: string; text: string }>
  onInputChange: () => void
  onResolve: (action: GateAction) => void
  onSelectGateAction: (action: GateAction) => void
  onSubmit: () => void
}) {
  const slashPopupHeight = showSlashCommands ? slashCommandPopupHeight(slashCommands) : 0
  const transcriptHeight = Math.max(6, height - (pendingGate ? 16 : 8) - slashPopupHeight)
  const transcriptScrollRef = useRef<ScrollBoxRenderable>(null)
  const transcriptEndKey = transcript.map((item) => `${item.id}:${item.text.length}`).join("|")

  useEffect(() => {
    const scrollbox = transcriptScrollRef.current
    if (!scrollbox) return
    scrollbox.scrollTo({ x: 0, y: scrollbox.scrollHeight })
  }, [transcriptEndKey, transcriptHeight])

  return (
    <box style={{ height, flexDirection: "column", alignItems: "center", backgroundColor: "#050505", paddingTop: 1 }}>
      <scrollbox
        ref={transcriptScrollRef}
        style={{
          width: contentWidth,
          height: transcriptHeight,
          paddingBottom: 1,
          stickyScroll: true,
          stickyStart: "bottom",
          scrollY: true,
        }}
      >
        {transcript.map((item) => (
          <TranscriptMessage key={item.id} item={item} markdownStyle={markdownStyle} width={contentWidth} />
        ))}
        {isThinking ? <ThinkingMessage spinner={spinner} width={contentWidth} /> : null}
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
        <box style={{ width: composerWidth, height: 1 }} />
      )}
      <Composer
        focused={!pendingGate}
        inputRef={inputRef}
        isThinking={isThinking}
        railColor={railColor}
        selectedSlashCommandIndex={selectedSlashCommandIndex}
        showSlashCommands={showSlashCommands}
        slashCommands={slashCommands}
        spinner={spinner}
        width={composerWidth}
        onInputChange={onInputChange}
        onSubmit={onSubmit}
      />
      {lastError ? <StatusLine connected={false} status="error" message={lastError} width={composerWidth} /> : null}
    </box>
  )
}

function TranscriptMessage({
  item,
  markdownStyle,
  width,
}: {
  item: { id: string; role: string; text: string }
  markdownStyle: SyntaxStyle
  width: number
}) {
  if (item.role === "user") {
    return (
      <box style={{ width, flexDirection: "row", backgroundColor: "#141414", marginBottom: 2 }}>
        <box style={{ width: 1, backgroundColor: "#2ee66b" }} />
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
          <markdown content={item.text || " "} syntaxStyle={markdownStyle} />
        </box>
      </box>
    )
  }

  if (item.role === "assistant") {
    return (
      <box style={{ width, flexDirection: "column", paddingLeft: 3, paddingRight: 2, marginBottom: 2 }}>
        <markdown content={item.text || " "} syntaxStyle={markdownStyle} />
        <BuildLine />
      </box>
    )
  }

  return (
    <box style={{ width, flexDirection: "column", paddingLeft: 3, paddingRight: 2, marginBottom: 2 }}>
      <text fg="#d29922">{item.text || " "}</text>
    </box>
  )
}

function BuildLine() {
  return (
    <box style={{ height: 1, flexDirection: "row", marginTop: 1 }}>
      <text fg="#2ee66b">▣</text>
      <text fg="#2ee66b"> Build</text>
      <text fg="#777777"> · </text>
      <text fg="#d0d0d0">GPT-5.5</text>
      <text fg="#777777"> · 1.6s</text>
    </box>
  )
}

function ThinkingMessage({ spinner, width }: { spinner: string; width: number }) {
  return (
    <box style={{ width, flexDirection: "column", paddingLeft: 3, paddingRight: 2, marginBottom: 2 }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg="#2ee66b">{spinner}</text>
        <text fg="#2ee66b"> Build</text>
        <text fg="#777777"> · </text>
        <text fg="#d0d0d0">thinking</text>
      </box>
    </box>
  )
}

function Composer({
  focused,
  inputRef,
  isThinking,
  railColor,
  selectedSlashCommandIndex,
  showSlashCommands,
  slashCommands,
  spinner,
  width,
  onInputChange,
  onSubmit,
}: {
  focused: boolean
  inputRef: RefObject<TextareaRenderable | null>
  isThinking: boolean
  railColor: string
  selectedSlashCommandIndex: number
  showSlashCommands: boolean
  slashCommands: SlashCommand[]
  spinner: string
  width: number
  onInputChange: () => void
  onSubmit: () => void
}) {
  return (
    <box style={{ width, flexDirection: "column" }}>
      {showSlashCommands ? (
        <SlashCommandPopup
          commands={slashCommands}
          selectedIndex={selectedSlashCommandIndex}
          width={width}
        />
      ) : null}
      <box style={{ width, height: 6, flexDirection: "row", backgroundColor: "#1f1f1f" }}>
        <box style={{ width: 1, backgroundColor: isThinking ? railColor : "#2ee66b" }} />
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
            {isThinking ? <text fg={railColor}> {spinner}</text> : null}
          </box>
        </box>
      </box>
    </box>
  )
}

function SlashCommandPopup({
  commands,
  selectedIndex,
  width,
}: {
  commands: SlashCommand[]
  selectedIndex: number
  width: number
}) {
  const visibleCommands = commands.slice(0, 6)
  const selectedVisibleIndex = wrapIndex(selectedIndex, visibleCommands.length)
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: "#111111", paddingTop: 1, paddingBottom: 1 }}>
      {visibleCommands.map((command, index) => (
        <SlashCommandRow
          key={command.name}
          command={command}
          selected={index === selectedVisibleIndex}
          width={width}
        />
      ))}
      <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg="#606060">{truncate("up/down select · enter run · esc close", width - 4)}</text>
      </box>
    </box>
  )
}

function SlashCommandRow({
  command,
  selected,
  width,
}: {
  command: SlashCommand
  selected: boolean
  width: number
}) {
  const marker = selected ? ">" : " "
  const commandWidth = 12
  const descriptionWidth = Math.max(10, width - commandWidth - 7)
  return (
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, backgroundColor: selected ? "#1b1b1b" : "#111111" }}>
      <text fg={selected ? "#2ee66b" : "#707070"}>{marker} </text>
      <text fg={selected ? "#8cffb0" : "#d0d0d0"}>{padEnd(command.name, commandWidth)}</text>
      <text fg="#777777">{truncate(command.description, descriptionWidth)}</text>
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

function padEnd(value: string, length: number): string {
  return value.length >= length ? value.slice(0, length) : value + " ".repeat(length - value.length)
}

function slashCommandPopupHeight(commands: SlashCommand[]): number {
  return Math.min(commands.length, 6) + 3
}

function filteredSlashCommands(input: string): SlashCommand[] {
  if (!isSlashCommandInput(input)) return []
  const query = slashCommandQuery(input)
  if (!query) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter((command) => {
    const haystack = `${command.name} ${command.description}`.toLowerCase()
    return haystack.includes(query)
  })
}

function isSlashCommandInput(input: string): boolean {
  const trimmed = input.trimStart()
  return trimmed.startsWith("/") && !trimmed.includes(" ")
}

function slashCommandQuery(input: string): string {
  if (!isSlashCommandInput(input)) return ""
  return input.trimStart().slice(1).toLowerCase()
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return ((index % length) + length) % length
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

function isTerminalRunStatusEvent(event: AppEvent): event is Extract<AppEvent, { type: "run_status" }> {
  if (event.type !== "run_status") return false
  return ["completed", "failed", "cancelled", "killed"].includes(event.status)
}

function useActivityFrame(active: boolean): { spinner: string; railColor: string } {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!active) {
      setFrame(0)
      return
    }

    const timer = setInterval(() => {
      setFrame((current) => current + 1)
    }, 120)

    return () => clearInterval(timer)
  }, [active])

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const railColors = ["#165f32", "#1f8f46", "#2ee66b", "#8cffb0", "#2ee66b", "#1f8f46"]

  return {
    spinner: spinnerFrames[frame % spinnerFrames.length],
    railColor: railColors[frame % railColors.length],
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
