import { SyntaxStyle, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import type { ClientConfig } from "../config"
import { GatewayClient } from "../gateway/client"
import type { AppEvent, HistoryResponse, ThreadInfo } from "../gateway/types"
import { parseModelListResponse, selectedModelFromSwitchResponse, withSelectedModel } from "../modelCommands"
import { activeProfileFromCliResult, shouldUseLocalDevYoloSplash } from "../rebornProfile"
import { formatLocalCliResult, formatRebornCliCommand, runRebornCli } from "../rebornCli"
import { initialUiState, reduceUiState, type ActivityItem } from "../state"
import { ConversationSurface, WelcomeSurface, type ComposerCommonProps, type GateAction } from "./MainSurfaces"
import { SettingsSurface, SETTINGS_SECTION_COUNT } from "./SettingsSurface"
import {
  filteredSlashCommands,
  isSlashCommandInput,
  localCliCommandForInput,
  slashCommandsForMode,
  type SlashCommand,
} from "./slashCommands"

type AppProps = {
  config: ClientConfig
}

type ActiveOverlay = "commands" | "threads" | "models" | "settings" | null

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
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null)
  const [paletteThreads, setPaletteThreads] = useState<ThreadInfo[]>([])
  const [selectedSettingsIndex, setSelectedSettingsIndex] = useState(0)
  const [activeRebornProfile, setActiveRebornProfile] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState(config.models)
  const [selectedModelIndex, setSelectedModelIndex] = useState(() => modelIndex(config.models, config.model))
  const [selectedModel, setSelectedModel] = useState(config.model)
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(() => new Set())
  const activityFrame = useActivityFrame(state.isThinking)
  const thinkingLabel = thinkingLabelForActivity(state.activity, state.status, state.isThinking)
  const showCommandPalette = activeOverlay === "commands"
  const showThreadPalette = activeOverlay === "threads"
  const showModelPalette = activeOverlay === "models"
  const showSettings = activeOverlay === "settings"
  const commandSet = useMemo(() => slashCommandsForMode(config.mode), [config.mode])
  const slashCommands = showCommandPalette ? commandSet : filteredSlashCommands(input, commandSet)
  const showSlashCommands = showCommandPalette || (isSlashCommandInput(input) && slashCommands.length > 0)
  const localDevYolo = shouldUseLocalDevYoloSplash(config.mode, activeRebornProfile)
  const canCancelRun = Boolean((state.pendingGate?.thread_id || state.activeThreadId) && (state.pendingGate?.run_id || state.activeRunId))

  const toggleActivityExpanded = (id: string) => {
    setExpandedActivityIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }
    if (showSettings) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        setActiveOverlay(null)
        return
      }
      if (key.name === "up" || key.name === "k") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedSettingsIndex((index) => wrapIndex(index - 1, SETTINGS_SECTION_COUNT))
        return
      }
      if (key.name === "down" || key.name === "tab" || key.name === "j") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedSettingsIndex((index) => wrapIndex(index + 1, SETTINGS_SECTION_COUNT))
        return
      }
      if (isPlainEnter(key)) {
        key.preventDefault()
        key.stopPropagation()
        return
      }
      return
    }
    if (showModelPalette) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        setActiveOverlay(null)
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
        setActiveOverlay(null)
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
      key.preventDefault()
      key.stopPropagation()
      if (showSlashCommands) {
        setInput("")
        setActiveOverlay(null)
        textareaRef.current?.clear()
        return
      }
      if (canCancelRun) void cancelActiveRun()
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
      setActiveOverlay("commands")
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
    let cancelled = false

    async function loadActiveProfile() {
      if (config.mode !== "local") {
        setActiveRebornProfile(null)
        return
      }

      try {
        const result = await runRebornCli(config, ["profile", "list", "--json"])
        if (!cancelled) setActiveRebornProfile(activeProfileFromCliResult(result))
      } catch {
        if (!cancelled) setActiveRebornProfile(null)
      }
    }

    void loadActiveProfile()

    return () => {
      cancelled = true
    }
  }, [config.mode, config.rebornBin, config.rebornFeatures, config.rebornSource])

  useEffect(() => {
    setSelectedCommandIndex(0)
    if (!isSlashCommandInput(input)) {
      setActiveOverlay((overlay) => (overlay === "commands" ? null : overlay))
    }
  }, [input])

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
      setActiveOverlay("threads")
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function openModelPalette() {
    const models = withSelectedModel(availableModels, selectedModel)
    setAvailableModels(models)
    setSelectedModelIndex(modelIndex(models, selectedModel))
    setActiveOverlay("models")
  }

  async function selectModel(index: number) {
    const model = availableModels[wrapIndex(index, availableModels.length)]
    if (!model) return
    const models = withSelectedModel(availableModels, model)
    setSelectedModel(model)
    setAvailableModels(models)
    setSelectedModelIndex(modelIndex(models, model))
    setActiveOverlay(null)
    await submitContent(`/model ${model}`)
  }

  async function selectThread(index: number) {
    const thread = paletteThreads[wrapIndex(index, paletteThreads.length)]
    if (!thread) return
    setActiveOverlay(null)
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
      setActiveOverlay(null)
      textareaRef.current?.clear()
      await openThreadPalette()
      return
    }
    if (command.action === "models") {
      setInput("")
      setActiveOverlay(null)
      textareaRef.current?.clear()
      await openModelPalette()
      return
    }
    if (command.action === "cancel-run") {
      setInput("")
      setActiveOverlay(null)
      textareaRef.current?.clear()
      await cancelActiveRun()
      return
    }
    if (command.action === "load-older") {
      setInput("")
      setActiveOverlay(null)
      textareaRef.current?.clear()
      await loadOlderHistory()
      return
    }
    if (command.action === "settings") {
      setInput("")
      setActiveOverlay("settings")
      textareaRef.current?.clear()
      return
    }
    if (command.action === "local-command" && command.localArgs && config.mode === "local") {
      setInput("")
      setActiveOverlay(null)
      textareaRef.current?.clear()
      await runLocalCliCommand(command.name, command.localArgs)
      return
    }
    if (command.action === "quit") {
      renderer.destroy()
      return
    }
    setActiveOverlay(null)
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
        for (const response of assistantResponses(history)) {
          applyModelCommandResponse(response)
        }
        dispatch({ type: "history", history })
        const assistantCount = assistantResponses(history).length
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
      setActiveOverlay(parsedList.models.length > 0 ? "models" : null)
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
  const handleInputChange = () => setInput(textareaRef.current?.plainText ?? "")
  const composer: ComposerCommonProps = {
    inputRef: textareaRef,
    isThinking: state.isThinking,
    railColor: activityFrame.railColor,
    selectedSlashCommandIndex: wrapIndex(selectedCommandIndex, slashCommands.length),
    selectedModel,
    selectedModelIndex,
    selectedThreadIndex,
    showModelPalette,
    showSlashCommands,
    showThreadPalette,
    slashCommands,
    spinner: activityFrame.spinner,
    thinkingLabel,
    activeThreadId: state.activeThreadId,
    models: availableModels,
    threads: showThreadPalette ? paletteThreads : state.threads,
    onInputChange: handleInputChange,
    onSubmit: submit,
  }

  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: "#050505" }}>
      {showSettings ? (
        <SettingsSurface
          config={config}
          connected={state.connected}
          height={height}
          selectedIndex={selectedSettingsIndex}
          selectedModel={selectedModel}
          status={state.status}
          width={width}
        />
      ) : hasConversation ? (
        <ConversationSurface
          contentWidth={conversationWidth}
          composer={composer}
          composerWidth={conversationWidth}
          height={height}
          lastError={state.lastError}
          markdownStyle={markdownStyle}
          pendingGate={state.pendingGate ?? null}
          selectedGateAction={selectedGateAction}
          showOlderHistoryHint={state.hasOlderHistory}
          transcript={state.transcript}
          expandedActivityIds={expandedActivityIds}
          onToggleActivityExpanded={toggleActivityExpanded}
          onResolve={(action) => void resolveGate(action)}
          onSelectGateAction={setSelectedGateAction}
        />
      ) : (
        <WelcomeSurface
          baseUrl={config.baseUrl}
          composer={composer}
          composerWidth={composerWidth}
          connected={state.connected}
          height={height}
          lastError={state.lastError}
          localDevYolo={localDevYolo}
          status={state.status}
          width={width}
        />
      )}
    </box>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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

function assistantResponses(history: HistoryResponse): string[] {
  if (history.messages) {
    return history.messages.flatMap((message) =>
      (message.kind === "assistant" || message.kind === "summary") && message.content ? [message.content] : [],
    )
  }
  return history.turns.flatMap((turn) => (turn.response ? [turn.response] : []))
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

function thinkingLabelForActivity(activity: ActivityItem[], status: string, isThinking: boolean): string {
  if (!isThinking) return "thinking"
  const runningActivity = [...activity].reverse().find((item) => item.status === "running")
  const key = uiStatusKey(runningActivity?.kind ?? status)
  switch (key) {
    case "tool_running":
      return "using tools"
    case "typing":
      return "writing"
    case "reflecting":
    case "sent":
    case "running":
      return "thinking"
    default:
      if (key.endsWith("_completed") || key.endsWith("_failed")) return "thinking"
      if (key.startsWith("running_")) return "using tools"
      if (key === "idle") return "thinking"
      return key ? key.replaceAll("_", " ") : "thinking"
  }
}

function uiStatusKey(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim().toLowerCase().replace(/\s+/g, "_")
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
