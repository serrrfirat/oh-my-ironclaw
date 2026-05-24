import { SyntaxStyle, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useEffect, useMemo, useReducer, useRef, useState, type RefObject } from "react"
import type { ClientConfig, ClientMode } from "../config"
import { GatewayClient } from "../gateway/client"
import type { AppEvent, PendingGateInfo, ThreadInfo } from "../gateway/types"
import { parseModelListResponse, selectedModelFromSwitchResponse, withSelectedModel } from "../modelCommands"
import { initialUiState, reduceUiState } from "../state"

type AppProps = {
  config: ClientConfig
}

type GateAction = "approved" | "denied"
type SlashCommandAction = "threads" | "models" | "cancel-run" | "load-older" | "local-command" | "quit"
type SlashCommandSource = "remote" | "local" | "tui"
type SlashCommand = {
  name: string
  description: string
  source: SlashCommandSource
  action?: SlashCommandAction
  localArgs?: string[]
}

const SLASH_COMMAND_POPUP_LIMIT = 8

const REMOTE_PRODUCT_COMMANDS: SlashCommand[] = [
  { name: "/model", description: "Show or switch the active model", source: "remote", action: "models" },
  { name: "/status", description: "Show Reborn product workflow status", source: "remote" },
  { name: "/progress", description: "Alias for Reborn product workflow status", source: "remote" },
]

const LOCAL_CLI_COMMANDS: SlashCommand[] = [
  {
    name: "/doctor",
    description: "Run ironclaw-reborn doctor",
    source: "local",
    action: "local-command",
    localArgs: ["doctor"],
  },
  {
    name: "/profile",
    description: "Run ironclaw-reborn profile list",
    source: "local",
    action: "local-command",
    localArgs: ["profile", "list"],
  },
  {
    name: "/skills",
    description: "Run ironclaw-reborn skills list",
    source: "local",
    action: "local-command",
    localArgs: ["skills", "list"],
  },
  {
    name: "/channels",
    description: "Run ironclaw-reborn channels list",
    source: "local",
    action: "local-command",
    localArgs: ["channels", "list"],
  },
  {
    name: "/hooks",
    description: "Run ironclaw-reborn hooks list",
    source: "local",
    action: "local-command",
    localArgs: ["hooks", "list"],
  },
  {
    name: "/models",
    description: "Run ironclaw-reborn models list",
    source: "local",
    action: "local-command",
    localArgs: ["models", "list"],
  },
  {
    name: "/model-status",
    description: "Run ironclaw-reborn models status",
    source: "local",
    action: "local-command",
    localArgs: ["models", "status"],
  },
  {
    name: "/logs",
    description: "Run ironclaw-reborn logs",
    source: "local",
    action: "local-command",
    localArgs: ["logs"],
  },
  {
    name: "/logs-json",
    description: "Run ironclaw-reborn logs --json",
    source: "local",
    action: "local-command",
    localArgs: ["logs", "--json"],
  },
  {
    name: "/config-path",
    description: "Run ironclaw-reborn config path",
    source: "local",
    action: "local-command",
    localArgs: ["config", "path"],
  },
  {
    name: "/traces-status",
    description: "Run ironclaw-reborn traces status",
    source: "local",
    action: "local-command",
    localArgs: ["traces", "status"],
  },
  {
    name: "/traces-queue",
    description: "Run ironclaw-reborn traces queue-status",
    source: "local",
    action: "local-command",
    localArgs: ["traces", "queue-status"],
  },
  {
    name: "/traces-credit",
    description: "Run ironclaw-reborn traces credit",
    source: "local",
    action: "local-command",
    localArgs: ["traces", "credit"],
  },
]

const TUI_CONTROL_COMMANDS: SlashCommand[] = [
  { name: "/threads", description: "Open thread picker", source: "tui", action: "threads" },
  { name: "/history", description: "Load older timeline messages", source: "tui", action: "load-older" },
  { name: "/run-cancel", description: "Cancel the active WebChat run", source: "tui", action: "cancel-run" },
  { name: "/quit", description: "Quit this TUI", source: "tui", action: "quit" },
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
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showThreadPalette, setShowThreadPalette] = useState(false)
  const [paletteThreads, setPaletteThreads] = useState<ThreadInfo[]>([])
  const [showModelPalette, setShowModelPalette] = useState(false)
  const [availableModels, setAvailableModels] = useState(config.models)
  const [selectedModelIndex, setSelectedModelIndex] = useState(() => modelIndex(config.models, config.model))
  const [selectedModel, setSelectedModel] = useState(config.model)
  const activityFrame = useActivityFrame(state.isThinking)
  const commandSet = useMemo(() => slashCommandsForMode(config.mode), [config.mode])
  const slashCommands = showCommandPalette ? commandSet : filteredSlashCommands(input, commandSet)
  const showSlashCommands = showCommandPalette || (isSlashCommandInput(input) && slashCommands.length > 0)

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }
    if (showModelPalette) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        setShowModelPalette(false)
        return
      }
      if (key.name === "up") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedModelIndex((index) => wrapIndex(index - 1, availableModels.length))
        return
      }
      if (key.name === "down" || key.name === "tab") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedModelIndex((index) => wrapIndex(index + 1, availableModels.length))
        return
      }
      if (isPlainEnter(key)) {
        key.preventDefault()
        key.stopPropagation()
        void selectModel(selectedModelIndex)
        return
      }
    }
    if (showThreadPalette) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        setShowThreadPalette(false)
        return
      }
      if (key.name === "up") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedThreadIndex((index) => wrapIndex(index - 1, paletteThreads.length))
        return
      }
      if (key.name === "down" || key.name === "tab") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedThreadIndex((index) => wrapIndex(index + 1, paletteThreads.length))
        return
      }
      if (isPlainEnter(key)) {
        key.preventDefault()
        key.stopPropagation()
        void selectThread(selectedThreadIndex)
        return
      }
    }
    if (key.name === "escape") {
      if (showSlashCommands) {
        key.preventDefault()
        key.stopPropagation()
        setInput("")
        setShowCommandPalette(false)
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
    if (key.ctrl && key.name === "p") {
      key.preventDefault()
      key.stopPropagation()
      setSelectedCommandIndex(0)
      setShowCommandPalette(true)
      return
    }
    if (key.ctrl && key.name === "t") {
      key.preventDefault()
      key.stopPropagation()
      void openThreadPalette()
      return
    }
    if (key.ctrl && key.name === "m") {
      key.preventDefault()
      key.stopPropagation()
      void openModelPalette()
      return
    }
    if (key.ctrl && key.name === "x") {
      key.preventDefault()
      key.stopPropagation()
      void cancelActiveRun()
      return
    }
    if (key.name === "pageup") {
      key.preventDefault()
      key.stopPropagation()
      void loadOlderHistory()
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
    setSelectedModel(config.model)
    setAvailableModels(config.models)
    setSelectedModelIndex(modelIndex(config.models, config.model))
  }, [config.model, config.models])

  useEffect(() => {
    setSelectedCommandIndex(0)
    if (!isSlashCommandInput(input)) setShowCommandPalette(false)
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
              if (event.type === "response") applyModelCommandResponse(event.content)
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

  async function loadOlderHistory() {
    if (!state.activeThreadId || !state.historyCursor) return
    try {
      const history = await client.history(state.activeThreadId, 80, state.historyCursor)
      dispatch({ type: "older_history", history })
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function openThreadPalette() {
    try {
      const response = await client.threads()
      const remoteThreads = [response.assistant_thread, ...response.threads].filter(Boolean) as ThreadInfo[]
      const threads = mergeThreads(remoteThreads, state.threads, activeThreadFallback(state.activeThreadId))
      dispatch({ type: "threads", threads, activeThreadId: state.activeThreadId })
      const activeIndex = threads.findIndex((thread) => thread.id === state.activeThreadId)
      setPaletteThreads(threads)
      setSelectedThreadIndex(activeIndex >= 0 ? activeIndex : 0)
      setShowThreadPalette(true)
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function openModelPalette() {
    if (!availableModels.length) {
      await submitContent("/model")
      return
    }
    setSelectedModelIndex(modelIndex(availableModels, selectedModel))
    setShowModelPalette(true)
  }

  async function selectModel(index: number) {
    const model = availableModels[wrapIndex(index, availableModels.length)]
    if (!model) return
    const models = withSelectedModel(availableModels, model)
    setSelectedModel(model)
    setAvailableModels(models)
    setSelectedModelIndex(modelIndex(models, model))
    setShowModelPalette(false)
    await submitContent(`/model ${model}`)
  }

  async function selectThread(index: number) {
    const thread = paletteThreads[wrapIndex(index, paletteThreads.length)]
    if (!thread) return
    setShowThreadPalette(false)
    await loadThread(thread.id)
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
    const localCommand = localCliCommandForInput(content, config.mode)
    if (localCommand) {
      await runLocalCliCommand(content, localCommand)
      return
    }
    await submitContent(content)
  }

  async function submitContent(content: string) {
    const previousAssistantCount = state.transcript.filter((item) => item.role === "assistant").length
    applyOutgoingModelCommand(content)
    setInput("")
    textareaRef.current?.clear()
    dispatch({ type: "user_sent", content, threadId: state.activeThreadId })
    try {
      const response = await client.send(content, state.activeThreadId)
      const threadId = response.thread_id ?? state.activeThreadId
      dispatch({ type: "run_started", threadId, runId: response.run_id, status: response.status })
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
    if (command.action === "threads") {
      setInput("")
      setShowCommandPalette(false)
      textareaRef.current?.clear()
      await openThreadPalette()
      return
    }
    if (command.action === "models") {
      setInput("")
      setShowCommandPalette(false)
      textareaRef.current?.clear()
      await openModelPalette()
      return
    }
    if (command.action === "cancel-run") {
      setInput("")
      setShowCommandPalette(false)
      textareaRef.current?.clear()
      await cancelActiveRun()
      return
    }
    if (command.action === "load-older") {
      setInput("")
      setShowCommandPalette(false)
      textareaRef.current?.clear()
      await loadOlderHistory()
      return
    }
    if (command.action === "local-command" && command.localArgs && config.mode === "local") {
      setInput("")
      setShowCommandPalette(false)
      textareaRef.current?.clear()
      await runLocalCliCommand(command.name, command.localArgs)
      return
    }
    if (command.action === "quit") {
      renderer.destroy()
      return
    }
    setShowCommandPalette(false)
    await submitContent(command.name)
  }

  async function runLocalCliCommand(content: string, args: string[]) {
    const threadId = state.activeThreadId ?? "local"
    setInput("")
    textareaRef.current?.clear()
    dispatch({ type: "user_sent", content, threadId })
    try {
      const result = await runRebornCli(config, args)
      dispatch({
        type: "event",
        event: {
          type: "response",
          content: formatLocalCliResult(result),
          thread_id: threadId,
        },
      })
    } catch (error) {
      dispatch({
        type: "event",
        event: {
          type: "response",
          content: `Failed to run ${formatRebornCliCommand(config, args)}:\n\n${errorMessage(error)}`,
          thread_id: threadId,
        },
      })
    }
  }

  async function cancelActiveRun() {
    const threadId = state.pendingGate?.thread_id || state.activeThreadId
    const runId = state.pendingGate?.run_id || state.activeRunId
    if (!threadId || !runId) {
      dispatch({ type: "error", message: "No active run to cancel." })
      return
    }
    try {
      const response = await client.cancelRun(threadId, runId)
      dispatch({
        type: "event",
        event: { type: "run_status", status: response.status || "cancelled", run_id: response.run_id, thread_id: threadId },
      })
      await loadThread(threadId)
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function pollThreadForReply(threadId: string, previousAssistantCount: number) {
    for (const delay of [750, 1250, 2000, 3000, 5000, 8000, 12000]) {
      await sleep(delay)
      try {
        const history = await client.history(threadId)
        for (const turn of history.turns) {
          if (turn.response) applyModelCommandResponse(turn.response)
        }
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

  function applyOutgoingModelCommand(content: string) {
    const trimmed = content.trim()
    if (!trimmed.startsWith("/model ")) return
    const model = trimmed.slice("/model ".length).trim()
    if (!model) return
    setSelectedModel(model)
    const models = withSelectedModel(availableModels, model)
    setAvailableModels(models)
    setSelectedModelIndex(modelIndex(models, model))
  }

  function applyModelCommandResponse(content: string): boolean {
    const parsedList = parseModelListResponse(content)
    if (parsedList) {
      setSelectedModel(parsedList.activeModel)
      setAvailableModels(parsedList.models)
      setSelectedModelIndex(modelIndex(parsedList.models, parsedList.activeModel))
      setShowModelPalette(parsedList.models.length > 0)
      setShowCommandPalette(false)
      setShowThreadPalette(false)
      return true
    }

    const switchedModel = selectedModelFromSwitchResponse(content)
    if (!switchedModel) return false
    const models = withSelectedModel(availableModels, switchedModel)
    setSelectedModel(switchedModel)
    setAvailableModels(models)
    setSelectedModelIndex(modelIndex(models, switchedModel))
    return true
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
          selectedModel={selectedModel}
          selectedModelIndex={selectedModelIndex}
          selectedThreadIndex={selectedThreadIndex}
          showOlderHistoryHint={state.hasOlderHistory}
          showModelPalette={showModelPalette}
          showSlashCommands={showSlashCommands}
          showThreadPalette={showThreadPalette}
          slashCommands={slashCommands}
          spinner={activityFrame.spinner}
          activeThreadId={state.activeThreadId}
          models={availableModels}
          threads={showThreadPalette ? paletteThreads : state.threads}
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
          selectedModel={selectedModel}
          selectedModelIndex={selectedModelIndex}
          selectedThreadIndex={selectedThreadIndex}
          showModelPalette={showModelPalette}
          showSlashCommands={showSlashCommands}
          showThreadPalette={showThreadPalette}
          slashCommands={slashCommands}
          spinner={activityFrame.spinner}
          status={state.status}
          activeThreadId={state.activeThreadId}
          models={availableModels}
          threads={showThreadPalette ? paletteThreads : state.threads}
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
  selectedModel,
  selectedModelIndex,
  selectedThreadIndex,
  showModelPalette,
  showSlashCommands,
  showThreadPalette,
  slashCommands,
  spinner,
  status,
  activeThreadId,
  models,
  threads,
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
  selectedModel: string
  selectedModelIndex: number
  selectedThreadIndex: number
  showModelPalette: boolean
  showSlashCommands: boolean
  showThreadPalette: boolean
  slashCommands: SlashCommand[]
  spinner: string
  status: string
  activeThreadId?: string | null
  models: string[]
  threads: ThreadInfo[]
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
        selectedModel={selectedModel}
        selectedModelIndex={selectedModelIndex}
        selectedThreadIndex={selectedThreadIndex}
        showModelPalette={showModelPalette}
        showSlashCommands={showSlashCommands}
        showThreadPalette={showThreadPalette}
        slashCommands={slashCommands}
        spinner={spinner}
        activeThreadId={activeThreadId}
        models={models}
        threads={threads}
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
  selectedModel,
  selectedModelIndex,
  selectedThreadIndex,
  showOlderHistoryHint,
  showModelPalette,
  showSlashCommands,
  showThreadPalette,
  slashCommands,
  spinner,
  activeThreadId,
  models,
  threads,
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
  selectedModel: string
  selectedModelIndex: number
  selectedThreadIndex: number
  showOlderHistoryHint: boolean
  showModelPalette: boolean
  showSlashCommands: boolean
  showThreadPalette: boolean
  slashCommands: SlashCommand[]
  spinner: string
  activeThreadId?: string | null
  models: string[]
  threads: ThreadInfo[]
  transcript: Array<{ id: string; role: string; text: string }>
  onInputChange: () => void
  onResolve: (action: GateAction) => void
  onSelectGateAction: (action: GateAction) => void
  onSubmit: () => void
}) {
  const slashPopupHeight = showSlashCommands ? slashCommandPopupHeight(slashCommands) : 0
  const threadPopupHeight = showThreadPalette ? threadPaletteHeight(threads) : 0
  const modelPopupHeight = showModelPalette ? modelPaletteHeight(models) : 0
  const transcriptHeight = Math.max(6, height - (pendingGate ? 16 : 8) - slashPopupHeight - threadPopupHeight - modelPopupHeight)
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
        {showOlderHistoryHint ? <LoadOlderHint width={contentWidth} /> : null}
        {transcript.map((item) => (
          <TranscriptMessage key={item.id} item={item} markdownStyle={markdownStyle} selectedModel={selectedModel} width={contentWidth} />
        ))}
        {isThinking ? <ThinkingMessage selectedModel={selectedModel} spinner={spinner} width={contentWidth} /> : null}
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
        selectedModel={selectedModel}
        selectedModelIndex={selectedModelIndex}
        selectedThreadIndex={selectedThreadIndex}
        showModelPalette={showModelPalette}
        showSlashCommands={showSlashCommands}
        showThreadPalette={showThreadPalette}
        slashCommands={slashCommands}
        spinner={spinner}
        activeThreadId={activeThreadId}
        models={models}
        threads={threads}
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
  selectedModel,
  width,
}: {
  item: { id: string; role: string; text: string }
  markdownStyle: SyntaxStyle
  selectedModel: string
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
        <BuildLine selectedModel={selectedModel} />
      </box>
    )
  }

  return (
    <box style={{ width, flexDirection: "column", paddingLeft: 3, paddingRight: 2, marginBottom: 2 }}>
      <text fg="#d29922">{item.text || " "}</text>
    </box>
  )
}

function BuildLine({ selectedModel }: { selectedModel: string }) {
  return (
    <box style={{ height: 1, flexDirection: "row", marginTop: 1 }}>
      <text fg="#2ee66b">▣</text>
      <text fg="#2ee66b"> Build</text>
      <text fg="#777777"> · </text>
      <text fg="#d0d0d0">{selectedModel}</text>
      <text fg="#777777"> · 1.6s</text>
    </box>
  )
}

function ThinkingMessage({ selectedModel, spinner, width }: { selectedModel: string; spinner: string; width: number }) {
  return (
    <box style={{ width, flexDirection: "column", paddingLeft: 3, paddingRight: 2, marginBottom: 2 }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg="#2ee66b">{spinner}</text>
        <text fg="#2ee66b"> Build</text>
        <text fg="#777777"> · </text>
        <text fg="#d0d0d0">{selectedModel}</text>
        <text fg="#777777"> · thinking</text>
      </box>
    </box>
  )
}

function LoadOlderHint({ width }: { width: number }) {
  return (
    <box style={{ width, height: 2, flexDirection: "column", paddingLeft: 3, marginBottom: 1 }}>
      <text fg="#777777">{truncate("/history or pageup to load older messages", Math.max(1, width - 3))}</text>
    </box>
  )
}

function Composer({
  focused,
  inputRef,
  isThinking,
  railColor,
  selectedSlashCommandIndex,
  selectedModel,
  selectedModelIndex,
  selectedThreadIndex,
  showModelPalette,
  showSlashCommands,
  showThreadPalette,
  slashCommands,
  spinner,
  activeThreadId,
  models,
  threads,
  width,
  onInputChange,
  onSubmit,
}: {
  focused: boolean
  inputRef: RefObject<TextareaRenderable | null>
  isThinking: boolean
  railColor: string
  selectedSlashCommandIndex: number
  selectedModel: string
  selectedModelIndex: number
  selectedThreadIndex: number
  showModelPalette: boolean
  showSlashCommands: boolean
  showThreadPalette: boolean
  slashCommands: SlashCommand[]
  spinner: string
  activeThreadId?: string | null
  models: string[]
  threads: ThreadInfo[]
  width: number
  onInputChange: () => void
  onSubmit: () => void
}) {
  return (
    <box style={{ width, flexDirection: "column" }}>
      {showModelPalette ? (
        <ModelPalette
          models={models}
          selectedIndex={selectedModelIndex}
          selectedModel={selectedModel}
          width={width}
        />
      ) : null}
      {showThreadPalette ? (
        <ThreadPalette
          activeThreadId={activeThreadId}
          selectedIndex={selectedThreadIndex}
          threads={threads}
          width={width}
        />
      ) : null}
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
            <text fg="#d0d0d0">{selectedModel}</text>
            <text fg="#858585"> OpenAI</text>
            {isThinking ? <text fg={railColor}> {spinner}</text> : null}
          </box>
        </box>
      </box>
    </box>
  )
}

function ThreadPalette({
  activeThreadId,
  selectedIndex,
  threads,
  width,
}: {
  activeThreadId?: string | null
  selectedIndex: number
  threads: ThreadInfo[]
  width: number
}) {
  const visibleThreads = threads.slice(0, 8)
  const selectedVisibleIndex = wrapIndex(selectedIndex, visibleThreads.length)
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: "#101010", paddingTop: 1, paddingBottom: 1 }}>
      <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg="#8cffb0">threads</text>
        <text fg="#777777"> · up/down select · enter open · esc close</text>
      </box>
      {visibleThreads.length ? (
        visibleThreads.map((thread, index) => (
          <ThreadRow
            key={thread.id}
            active={thread.id === activeThreadId}
            selected={index === selectedVisibleIndex}
            thread={thread}
            width={width}
          />
        ))
      ) : (
        <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
          <text fg="#777777">No threads yet.</text>
        </box>
      )}
    </box>
  )
}

function ThreadRow({
  active,
  selected,
  thread,
  width,
}: {
  active: boolean
  selected: boolean
  thread: ThreadInfo
  width: number
}) {
  const marker = selected ? ">" : active ? "*" : " "
  const title = thread.title || thread.id
  const suffix = active ? " active" : ` ${thread.state}`
  return (
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, backgroundColor: selected ? "#1b1b1b" : "#101010" }}>
      <text fg={selected || active ? "#2ee66b" : "#707070"}>{marker} </text>
      <text fg={selected ? "#f2f2f2" : "#d0d0d0"}>{truncate(title, Math.max(8, width - suffix.length - 8))}</text>
      <text fg={active ? "#8cffb0" : "#777777"}>{suffix}</text>
    </box>
  )
}

function ModelPalette({
  models,
  selectedIndex,
  selectedModel,
  width,
}: {
  models: string[]
  selectedIndex: number
  selectedModel: string
  width: number
}) {
  const visibleModels = models.slice(0, 8)
  const selectedVisibleIndex = wrapIndex(selectedIndex, visibleModels.length)
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: "#101010", paddingTop: 1, paddingBottom: 1 }}>
      <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg="#8cffb0">models</text>
        <text fg="#777777"> · up/down select · enter use · esc close</text>
      </box>
      {visibleModels.map((model, index) => (
        <ModelRow
          key={model}
          active={model === selectedModel}
          model={model}
          selected={index === selectedVisibleIndex}
          width={width}
        />
      ))}
      <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg="#606060">{truncate("sends /model through Reborn command workflow", Math.max(1, width - 4))}</text>
      </box>
    </box>
  )
}

function ModelRow({
  active,
  model,
  selected,
  width,
}: {
  active: boolean
  model: string
  selected: boolean
  width: number
}) {
  const marker = selected ? ">" : active ? "*" : " "
  const suffix = active ? " selected" : ""
  return (
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, backgroundColor: selected ? "#1b1b1b" : "#101010" }}>
      <text fg={selected || active ? "#2ee66b" : "#707070"}>{marker} </text>
      <text fg={selected ? "#f2f2f2" : "#d0d0d0"}>{truncate(model, Math.max(8, width - suffix.length - 8))}</text>
      <text fg={active ? "#8cffb0" : "#777777"}>{suffix}</text>
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
  const selected = wrapIndex(selectedIndex, commands.length)
  const start = clamp(selected - SLASH_COMMAND_POPUP_LIMIT + 1, 0, Math.max(0, commands.length - SLASH_COMMAND_POPUP_LIMIT))
  const visibleCommands = commands.slice(start, start + SLASH_COMMAND_POPUP_LIMIT)
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: "#111111", paddingTop: 1, paddingBottom: 1 }}>
      {visibleCommands.map((command, index) => (
        <SlashCommandRow
          key={command.name}
          command={command}
          selected={start + index === selected}
          width={width}
        />
      ))}
      <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg="#606060">{truncate(commandPopupHint(start, visibleCommands.length, commands.length), width - 4)}</text>
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
  const commandWidth = 17
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
      <text fg="#cfcfcf">ctrl+p</text>
      <text fg="#777777"> commands   </text>
      <text fg="#cfcfcf">ctrl+t</text>
      <text fg="#777777"> threads   </text>
      <text fg="#cfcfcf">ctrl+m</text>
      <text fg="#777777"> model   </text>
      <text fg="#cfcfcf">ctrl+x</text>
      <text fg="#777777"> cancel</text>
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

function commandPopupHint(start: number, count: number, total: number): string {
  const range = total > count ? ` · ${start + 1}-${start + count}/${total}` : ""
  return `up/down select · enter run · esc close${range}`
}

function slashCommandPopupHeight(commands: SlashCommand[]): number {
  return Math.min(commands.length, SLASH_COMMAND_POPUP_LIMIT) + 3
}

function threadPaletteHeight(threads: ThreadInfo[]): number {
  return Math.min(Math.max(threads.length, 1), 8) + 3
}

function modelPaletteHeight(models: string[]): number {
  return Math.min(Math.max(models.length, 1), 8) + 3
}

function modelIndex(models: string[], model: string): number {
  const index = models.indexOf(model)
  return index >= 0 ? index : 0
}

function mergeThreads(...groups: Array<ThreadInfo[]>): ThreadInfo[] {
  const seen = new Set<string>()
  const merged: ThreadInfo[] = []
  for (const thread of groups.flat()) {
    if (seen.has(thread.id)) continue
    seen.add(thread.id)
    merged.push(thread)
  }
  return merged
}

function activeThreadFallback(threadId?: string | null): ThreadInfo[] {
  if (!threadId) return []
  return [
    {
      id: threadId,
      state: "active",
      turn_count: 0,
      created_at: "",
      updated_at: "",
      title: "Current thread",
      thread_type: "webchat_v2",
      channel: "webchat_v2",
    },
  ]
}

function slashCommandsForMode(mode: ClientMode): SlashCommand[] {
  return [
    ...REMOTE_PRODUCT_COMMANDS,
    ...(mode === "local" ? LOCAL_CLI_COMMANDS : []),
    ...TUI_CONTROL_COMMANDS,
  ]
}

function localCliCommandForInput(input: string, mode: ClientMode): string[] | null {
  if (mode !== "local") return null
  const trimmed = input.trim()
  const command = LOCAL_CLI_COMMANDS.find((candidate) => candidate.name === trimmed)
  return command?.localArgs ?? null
}

function filteredSlashCommands(input: string, commands: SlashCommand[]): SlashCommand[] {
  if (!isSlashCommandInput(input)) return []
  const query = slashCommandQuery(input)
  if (!query) return commands
  return commands.filter((command) => {
    const haystack = `${command.name} ${command.source} ${command.description}`.toLowerCase()
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

type CliResult = {
  command: string
  exitCode: number
  stdout: string
  stderr: string
}

async function runRebornCli(config: ClientConfig, args: string[]): Promise<CliResult> {
  const invocation = rebornCliInvocation(config, args)
  const proc = Bun.spawn(invocation.argv, {
    cwd: invocation.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { command: invocation.command, exitCode, stdout, stderr }
}

function rebornCliInvocation(config: ClientConfig, args: string[]): { argv: string[]; command: string; cwd?: string } {
  if (!config.rebornSource) {
    const argv = [config.rebornBin, ...args]
    return { argv, command: shellCommand(argv) }
  }

  const argv = ["cargo", "run", "-p", "ironclaw_reborn_cli"]
  if (config.rebornFeatures) argv.push("--features", config.rebornFeatures)
  argv.push("--bin", "ironclaw-reborn", "--", ...args)
  return {
    argv,
    command: `(cd ${shellWord(config.rebornSource)} && ${shellCommand(argv)})`,
    cwd: config.rebornSource,
  }
}

function formatRebornCliCommand(config: ClientConfig, args: string[]): string {
  return rebornCliInvocation(config, args).command
}

function formatLocalCliResult(result: CliResult): string {
  const body = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n\n")
  const suffix = result.exitCode === 0 ? "" : `\n\n(exit ${result.exitCode})`
  return `$ ${result.command}\n\n${body || "(no output)"}${suffix}`
}

function shellCommand(argv: string[]): string {
  return argv.map(shellWord).join(" ")
}

function shellWord(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
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
