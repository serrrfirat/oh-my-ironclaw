import { SyntaxStyle, type KeyEvent, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import type { ClientConfig } from "../config"
import { GatewayClient } from "../gateway/client"
import type { AppEvent, HistoryResponse, PendingGateInfo, ThreadInfo } from "../gateway/types"
import { parseModelListResponse, selectedModelFromSwitchResponse, withSelectedModel } from "../modelCommands"
import { activeProfileFromCliResult, shouldUseLocalDevYoloSplash } from "../rebornProfile"
import { formatLocalCliResult, formatRebornCliCommand, runRebornCli } from "../rebornCli"
import { filterSkills, parseSkillListOutput, skillDetailPath, type SkillListItem, type SkillListResult } from "../skillList"
import { initialUiState, reduceUiState, type ActivityItem } from "../state"
import { filterThreads, sortThreadsByRecent, threadPreviewFromHistory, type ThreadPreviewMap } from "../threadPreviews"
import { ConversationSurface, WelcomeSurface, type ComposerCommonProps, type GateAction } from "./MainSurfaces"
import { SettingsSurface, SETTINGS_SECTION_COUNT } from "./SettingsSurface"
import { SkillsSurface, type SkillDetailView } from "./SkillsSurface"
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

type ActiveOverlay = "commands" | "threads" | "models" | "settings" | "skills" | null
const INPUT_HISTORY_LIMIT = 100

export function App({ config }: AppProps) {
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()
  const client = useMemo(() => new GatewayClient(config), [config])
  const markdownStyle = useMemo(() => SyntaxStyle.create(), [])
  const textareaRef = useRef<TextareaRenderable>(null)
  const activeThreadIdRef = useRef<string | null | undefined>(null)
  const inputHistoryRef = useRef<string[]>([])
  const inputHistoryIndexRef = useRef<number | null>(null)
  const inputHistoryDraftRef = useRef("")
  const suppressInputHistoryResetRef = useRef(false)
  const authTokenCredentialRef = useRef<{ gateKey: string | null; credentialRef: string | null }>({ gateKey: null, credentialRef: null })
  const [state, dispatch] = useReducer(reduceUiState, initialUiState)
  const [input, setInput] = useState("")
  const [authTokenInput, setAuthTokenInput] = useState("")
  const [authTokenError, setAuthTokenError] = useState<string | null>(null)
  const [authTokenSubmitting, setAuthTokenSubmitting] = useState(false)
  const [selectedThreadIndex, setSelectedThreadIndex] = useState(0)
  const [selectedGateAction, setSelectedGateAction] = useState<GateAction>("approved")
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null)
  const [paletteThreads, setPaletteThreads] = useState<ThreadInfo[]>([])
  const [threadSearch, setThreadSearch] = useState("")
  const [threadPreviews, setThreadPreviews] = useState<ThreadPreviewMap>({})
  const [selectedSettingsIndex, setSelectedSettingsIndex] = useState(0)
  const [activeRebornProfile, setActiveRebornProfile] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState(config.models)
  const [selectedModelIndex, setSelectedModelIndex] = useState(() => modelIndex(config.models, config.model))
  const [selectedModel, setSelectedModel] = useState(config.model)
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(() => new Set())
  const [skillList, setSkillList] = useState<SkillListResult>({ configured: 0, source: "", skills: [], details: {} })
  const [skillSearch, setSkillSearch] = useState("")
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0)
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [skillDetail, setSkillDetail] = useState<SkillDetailView | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const activityFrame = useActivityFrame(state.isThinking)
  const thinkingLabel = thinkingLabelForActivity(state.activity, state.status, state.isThinking)
  const showCommandPalette = activeOverlay === "commands"
  const showThreadPalette = activeOverlay === "threads"
  const showModelPalette = activeOverlay === "models"
  const showSettings = activeOverlay === "settings"
  const showSkills = activeOverlay === "skills"
  const commandSet = useMemo(() => slashCommandsForMode(config.mode), [config.mode])
  const slashCommands = showCommandPalette ? commandSet : filteredSlashCommands(input, commandSet)
  const filteredThreadList = useMemo(() => filterThreads(paletteThreads, threadSearch, threadPreviews), [paletteThreads, threadSearch, threadPreviews])
  const filteredSkillList = useMemo(() => filterSkills(skillList.skills, skillSearch), [skillList.skills, skillSearch])
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
    if (showSkills) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        setActiveOverlay(null)
        setSkillDetail(null)
        return
      }
      if (skillDetail) {
        if (key.name === "up" || key.name === "k") {
          key.preventDefault()
          key.stopPropagation()
          setSkillDetail((detail) => detail ? { ...detail, offset: Math.max(0, detail.offset - 1) } : detail)
          return
        }
        if (key.name === "down" || key.name === "j") {
          key.preventDefault()
          key.stopPropagation()
          setSkillDetail((detail) => detail ? { ...detail, offset: detail.offset + 1 } : detail)
          return
        }
        return
      }
      if (key.name === "up" || key.name === "k") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedSkillIndex((index) => wrapIndex(index - 1, filteredSkillList.length))
        return
      }
      if (key.name === "down" || key.name === "tab" || key.name === "j") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedSkillIndex((index) => wrapIndex(index + 1, filteredSkillList.length))
        return
      }
      if (isPlainEnter(key)) {
        key.preventDefault()
        key.stopPropagation()
        void openSelectedSkillDetail()
        return
      }
      if (key.name === "backspace" || key.name === "delete") {
        key.preventDefault()
        key.stopPropagation()
        setSkillSearch((query) => query.slice(0, -1))
        setSelectedSkillIndex(0)
        return
      }
      if (key.ctrl && key.name === "u") {
        key.preventDefault()
        key.stopPropagation()
        setSkillSearch("")
        setSelectedSkillIndex(0)
        return
      }
      const text = printableKeyText(key)
      if (text) {
        key.preventDefault()
        key.stopPropagation()
        setSkillSearch((query) => query + text)
        setSelectedSkillIndex(0)
        return
      }
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
      if (key.name === "up" || key.name === "k") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedThreadIndex((index) => wrapIndex(index - 1, filteredThreadList.length))
        return
      }
      if (key.name === "down" || key.name === "tab" || key.name === "j") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedThreadIndex((index) => wrapIndex(index + 1, filteredThreadList.length))
        return
      }
      if (isPlainEnter(key)) {
        key.preventDefault()
        key.stopPropagation()
        void selectThread(selectedThreadIndex)
        return
      }
      if (key.name === "backspace" || key.name === "delete") {
        key.preventDefault()
        key.stopPropagation()
        setThreadSearch((query) => query.slice(0, -1))
        setSelectedThreadIndex(0)
        return
      }
      if (key.ctrl && key.name === "u") {
        key.preventDefault()
        key.stopPropagation()
        setThreadSearch("")
        setSelectedThreadIndex(0)
        return
      }
      const text = printableKeyText(key)
      if (text) {
        key.preventDefault()
        key.stopPropagation()
        setThreadSearch((query) => query + text)
        setSelectedThreadIndex(0)
        return
      }
      return
    }
    if (key.name === "escape") {
      key.preventDefault()
      key.stopPropagation()
      if (showSlashCommands) {
        clearComposer()
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
    if (state.pendingGate && isAuthGate(state.pendingGate)) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        void cancelAuthGate()
        return
      }
      if (key.name === "backspace" || key.name === "delete") {
        key.preventDefault()
        key.stopPropagation()
        setAuthTokenInput((value) => value.slice(0, -1))
        setAuthTokenError(null)
        return
      }
      if (key.ctrl && key.name === "u") {
        key.preventDefault()
        key.stopPropagation()
        setAuthTokenInput("")
        setAuthTokenError(null)
        return
      }
      if (isPlainEnter(key)) {
        key.preventDefault()
        key.stopPropagation()
        void submitAuthToken()
        return
      }
      const text = printableKeyText(key)
      if (text) {
        key.preventDefault()
        key.stopPropagation()
        setAuthTokenInput((value) => value + text)
        setAuthTokenError(null)
        return
      }
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
      key.preventDefault()
      key.stopPropagation()
      navigateInputHistory("up")
      return
    }
    if (key.name === "down") {
      key.preventDefault()
      key.stopPropagation()
      navigateInputHistory("down")
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
      setAuthTokenInput("")
      setAuthTokenError(null)
      setAuthTokenSubmitting(false)
      authTokenCredentialRef.current = { gateKey: gateKey(state.pendingGate), credentialRef: null }
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
    activeThreadIdRef.current = state.activeThreadId
  }, [state.activeThreadId])

  useEffect(() => {
    if (!state.isThinking) return
    setNowMs(Date.now())
    const timer = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(timer)
  }, [state.isThinking])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        await client.health()
        dispatch({ type: "connected", connected: true, status: "connected" })
        await startNewThreadOnConnect()
        if (!cancelled) void syncActiveModel()
      } catch (error) {
        dispatch({ type: "error", message: errorMessage(error) })
      }
    }

    async function syncActiveModel() {
      try {
        const parsed = await client.activeModel()
        if (cancelled || !parsed) return
        applyActiveModel(parsed.activeModel, parsed.models)
      } catch {
        // Leave the configured model label in place if the probe fails.
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [client])

  useEffect(() => {
    const threadId = state.activeThreadId
    if (!threadId) return
    let cancelled = false

    void (async () => {
      while (!cancelled && activeThreadIdRef.current === threadId) {
        try {
          for await (const event of client.events(threadId)) {
            if (cancelled || activeThreadIdRef.current !== threadId) break
            const eventThreadId = threadIdFromEvent(event)
            if (eventThreadId && eventThreadId !== activeThreadIdRef.current) continue
            if (event.type === "response") applyModelCommandResponse(event.content)
            dispatch({ type: "event", event })
            if (isTerminalRunStatusEvent(event)) void refreshThreadFromEvent(eventThreadId)
          }
        } catch (error) {
          if (!cancelled && activeThreadIdRef.current === threadId) {
            dispatch({ type: "connected", connected: false, status: "reconnecting" })
            dispatch({ type: "error", message: errorMessage(error) })
            await sleep(1500)
          }
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [client, state.activeThreadId])

  async function startNewThreadOnConnect(): Promise<string | null> {
    const response = await client.threads()
    const existingThreads = sortThreadsByRecent([response.assistant_thread, ...response.threads].filter(Boolean) as ThreadInfo[])
    const thread = await client.newThread()
    const threads = mergeThreads([thread], existingThreads)

    activeThreadIdRef.current = thread.id
    dispatch({ type: "threads", threads, activeThreadId: thread.id })
    setSelectedThreadIndex(0)
    await loadThread(thread.id)
    return thread.id
  }

  async function loadThread(threadId: string) {
    try {
      activeThreadIdRef.current = threadId
      const history = await client.history(threadId)
      if (activeThreadIdRef.current !== threadId) return
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
      const remoteThreads = sortThreadsByRecent([response.assistant_thread, ...response.threads].filter(Boolean) as ThreadInfo[])
      const threads = sortThreadsByRecent(mergeThreads(remoteThreads, state.threads, activeThreadFallback(state.activeThreadId)))
      dispatch({ type: "threads", threads, activeThreadId: state.activeThreadId })
      const activeIndex = threads.findIndex((thread) => thread.id === state.activeThreadId)
      setPaletteThreads(threads)
      setThreadSearch("")
      setSelectedThreadIndex(activeIndex >= 0 ? activeIndex : 0)
      setActiveOverlay("threads")
      void loadThreadPreviews(threads)
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

  async function openSkillsPalette() {
    setActiveOverlay("skills")
    setSkillsLoading(true)
    setSkillsError(null)
    setSkillDetail(null)
    try {
      const result = await runRebornCli(config, ["skills", "list", "--json", "--verbose"])
      if (result.exitCode !== 0) {
        throw new Error(formatLocalCliResult(result))
      }
      const parsed = parseSkillListOutput(result.stdout)
      setSkillList(parsed)
      setSelectedSkillIndex(0)
    } catch (error) {
      setSkillList({ configured: 0, source: "", skills: [], details: {} })
      setSkillsError(errorMessage(error))
    } finally {
      setSkillsLoading(false)
    }
  }

  async function openSelectedSkillDetail() {
    const skill = filteredSkillList[wrapIndex(selectedSkillIndex, filteredSkillList.length)]
    if (!skill) return
    const path = skillDetailPath(skill, skillList.details)
    setSkillDetail({ skill, content: skill.content ?? "", error: null, loading: true, path, offset: 0 })
    try {
      const content = await readSkillDetail(skill, path)
      setSkillDetail({ skill, content, error: null, loading: false, path, offset: 0 })
    } catch (error) {
      setSkillDetail({ skill, content: "", error: errorMessage(error), loading: false, path, offset: 0 })
    }
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
    const thread = filteredThreadList[wrapIndex(index, filteredThreadList.length)]
    if (!thread) return
    setActiveOverlay(null)
    await loadThread(thread.id)
  }

  async function loadThreadPreviews(threads: ThreadInfo[]) {
    const missingThreads = threads.filter((thread) => !threadPreviews[thread.id])
    if (missingThreads.length === 0) return
    for (let index = 0; index < missingThreads.length; index += 10) {
      const previews = await Promise.all(missingThreads.slice(index, index + 10).map(async (thread) => {
        try {
          const history = await client.history(thread.id, 12)
          return [thread.id, threadPreviewFromHistory(history)] as const
        } catch {
          return [thread.id, ""] as const
        }
      }))
      setThreadPreviews((current) => {
        const next = { ...current }
        for (const [threadId, preview] of previews) {
          if (preview) next[threadId] = preview
        }
        return next
      })
    }
  }

  async function createThread() {
    try {
      const thread = await client.newThread()
      activeThreadIdRef.current = thread.id
      dispatch({ type: "threads", threads: [thread, ...state.threads], activeThreadId: thread.id })
      setSelectedThreadIndex(0)
      await loadThread(thread.id)
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function submit() {
    const content = input.trim()
    if (!content) return
    rememberInput(content)
    const slashCommand = commandSet.find((command) => command.name === content)
    if (slashCommand?.action) {
      await runSlashCommand(slashCommand)
      return
    }
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
    clearComposer()
    dispatch({ type: "user_sent", content, threadId: state.activeThreadId })
    try {
      const response = await client.send(content, state.activeThreadId)
      const threadId = response.thread_id ?? state.activeThreadId
      if (threadId) activeThreadIdRef.current = threadId
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
    switch (command.action) {
      case "threads":
        clearComposer()
        await openThreadPalette()
        return
      case "models":
        clearComposer()
        await openModelPalette()
        return
      case "skills":
        clearComposer("skills")
        await openSkillsPalette()
        return
      case "new-thread":
        clearComposer()
        await createThread()
        return
      case "cancel-run":
        clearComposer()
        await cancelActiveRun()
        return
      case "load-older":
        clearComposer()
        await loadOlderHistory()
        return
      case "settings":
        clearComposer("settings")
        return
      case "local-command":
        if (command.localArgs && config.mode === "local") {
          await runLocalCliCommand(command.name, command.localArgs)
          return
        }
        break
      case "quit":
        renderer.destroy()
        return
    }
    setActiveOverlay(null)
    await submitContent(command.name)
  }

  function clearComposer(nextOverlay: ActiveOverlay = null) {
    setComposerText("")
    setActiveOverlay(nextOverlay)
    resetInputHistoryNavigation()
  }

  function setComposerText(value: string) {
    suppressInputHistoryResetRef.current = true
    setInput(value)
    textareaRef.current?.setText(value)
    if (textareaRef.current) textareaRef.current.cursorOffset = value.length
    suppressInputHistoryResetRef.current = false
  }

  function rememberInput(content: string) {
    const history = inputHistoryRef.current
    if (history[history.length - 1] !== content) {
      inputHistoryRef.current = [...history, content].slice(-INPUT_HISTORY_LIMIT)
    }
    resetInputHistoryNavigation()
  }

  function navigateInputHistory(direction: "up" | "down") {
    const history = inputHistoryRef.current
    if (history.length === 0) return

    const currentIndex = inputHistoryIndexRef.current
    if (direction === "up") {
      const nextIndex = currentIndex === null ? history.length - 1 : Math.max(0, currentIndex - 1)
      if (currentIndex === null) inputHistoryDraftRef.current = input
      inputHistoryIndexRef.current = nextIndex
      setComposerText(history[nextIndex] ?? "")
      return
    }

    if (currentIndex === null) return
    if (currentIndex >= history.length - 1) {
      inputHistoryIndexRef.current = null
      setComposerText(inputHistoryDraftRef.current)
      return
    }

    const nextIndex = currentIndex + 1
    inputHistoryIndexRef.current = nextIndex
    setComposerText(history[nextIndex] ?? "")
  }

  function resetInputHistoryNavigation() {
    inputHistoryIndexRef.current = null
    inputHistoryDraftRef.current = ""
  }

  async function runLocalCliCommand(content: string, args: string[]) {
    const threadId = state.activeThreadId ?? "local"
    clearComposer()
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
    if (threadId !== activeThreadIdRef.current) return
    await sleep(150)
    if (threadId !== activeThreadIdRef.current) return
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

  function applyActiveModel(activeModel: string, models: string[]) {
    setSelectedModel(activeModel)
    setAvailableModels(models)
    setSelectedModelIndex(modelIndex(models, activeModel))
  }

  function applyModelCommandResponse(content: string): boolean {
    const parsedList = parseModelListResponse(content)
    if (parsedList) {
      applyActiveModel(parsedList.activeModel, parsedList.models)
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

  async function resolveGate(resolution: "approved" | "denied" | "cancelled") {
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

  async function submitAuthToken() {
    const gate = state.pendingGate
    if (!gate || !isAuthGate(gate) || authTokenSubmitting) return
    const token = authTokenInput.trim()
    if (!token) {
      setAuthTokenError("A token is required.")
      return
    }
    const threadId = gate.thread_id
    const runId = gate.run_id
    const gateRef = gate.gate_ref
    if (!threadId || !runId || !gateRef) {
      setAuthTokenError("Auth gate is missing run information.")
      return
    }
    const currentGateKey = gateKey(gate)
    setAuthTokenSubmitting(true)
    setAuthTokenError(null)
    try {
      if (authTokenCredentialRef.current.gateKey !== currentGateKey) {
        authTokenCredentialRef.current = { gateKey: currentGateKey, credentialRef: null }
      }
      let credentialRef = authTokenCredentialRef.current.credentialRef
      if (!credentialRef) {
        const submitted = await client.submitManualToken({
          provider: gate.provider || "github",
          account_label: gate.account_label || "Manual token",
          token,
          thread_id: threadId,
          run_id: runId,
          gate_ref: gateRef,
        })
        credentialRef = submitted.credential_ref ?? null
        if (!credentialRef) throw new Error("Manual token submit returned no credential reference.")
        authTokenCredentialRef.current = { gateKey: currentGateKey, credentialRef }
      }
      await client.resolveGate({
        request_id: gate.request_id,
        thread_id: threadId,
        run_id: runId,
        gate_ref: gateRef,
        resolution: "credential_provided",
        credential_ref: credentialRef,
      })
      setAuthTokenInput("")
      authTokenCredentialRef.current = { gateKey: null, credentialRef: null }
      dispatch({ type: "gate_cleared" })
    } catch (error) {
      setAuthTokenError(errorMessage(error))
    } finally {
      setAuthTokenSubmitting(false)
    }
  }

  async function cancelAuthGate() {
    setAuthTokenInput("")
    setAuthTokenError(null)
    await resolveGate("cancelled")
  }

  const hasConversation = state.transcript.length > 0 || Boolean(state.pendingGate)
  const composerWidth = clamp(width - 8, 42, 82)
  const conversationWidth = Math.max(1, width - 4)
  const turnElapsedMs = state.isThinking ? activeTurnElapsedMs(state.transcript, nowMs) : null
  const handleInputChange = () => {
    setInput(textareaRef.current?.plainText ?? "")
    if (!suppressInputHistoryResetRef.current) resetInputHistoryNavigation()
  }
  const composer: ComposerCommonProps = {
    inputRef: textareaRef,
    connected: state.connected,
    isThinking: state.isThinking,
    railColor: activityFrame.railColor,
    turnElapsedMs,
    selectedSlashCommandIndex: wrapIndex(selectedCommandIndex, slashCommands.length),
    selectedModel,
    selectedProvider: providerLabel(config.provider),
    selectedModelIndex,
    selectedThreadIndex,
    showModelPalette,
    showSlashCommands,
    showThreadPalette,
    slashCommands,
    spinner: activityFrame.spinner,
    threadPreviews,
    threadSearch,
    thinkingLabel,
    activeThreadId: state.activeThreadId,
    models: availableModels,
    threads: showThreadPalette ? filteredThreadList : state.threads,
    onInputChange: handleInputChange,
    onSubmit: submit,
  }

  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: "#050505" }}>
      {showSkills ? (
        <SkillsSurface
          detail={skillDetail}
          error={skillsError}
          filteredSkills={filteredSkillList}
          height={height}
          loading={skillsLoading}
          markdownStyle={markdownStyle}
          query={skillSearch}
          selectedIndex={wrapIndex(selectedSkillIndex, filteredSkillList.length)}
          source={skillList.source}
          totalCount={skillList.configured}
          width={width}
        />
      ) : showSettings ? (
        <SettingsSurface
          config={config}
          connected={state.connected}
          height={height}
          selectedIndex={selectedSettingsIndex}
          selectedModel={selectedModel}
          selectedProvider={providerLabel(config.provider)}
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
          authTokenInput={authTokenInput}
          authTokenError={authTokenError}
          authTokenSubmitting={authTokenSubmitting}
          showOlderHistoryHint={state.hasOlderHistory}
          transcript={state.transcript}
          expandedActivityIds={expandedActivityIds}
          onToggleActivityExpanded={toggleActivityExpanded}
          onResolve={(action) => void resolveGate(action)}
          onSelectGateAction={setSelectedGateAction}
          onSubmitAuthToken={() => void submitAuthToken()}
          onCancelAuthGate={() => void cancelAuthGate()}
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

function activeTurnElapsedMs(transcript: Array<{ role: string; meta?: { sentAtMs?: number } }>, nowMs: number): number | null {
  const sentAtMs = [...transcript].reverse().find((item) => item.role === "user" && item.meta?.sentAtMs)?.meta?.sentAtMs
  return sentAtMs ? Math.max(0, nowMs - sentAtMs) : null
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "nearai":
      return "NEAR AI"
    case "openai":
      return "OpenAI"
    case "anthropic":
      return "Anthropic"
    case "gemini":
    case "google":
      return "Google"
    case "ollama":
      return "Ollama"
    default:
      return provider
  }
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

function printableKeyText(key: KeyEvent): string {
  if (key.ctrl || key.meta || key.option || key.super || key.hyper) return ""
  if (key.sequence.length === 1 && key.sequence >= " " && key.sequence !== "\u007f") return key.sequence
  if (key.name.length === 1) return key.name
  return ""
}

function isTerminalRunStatusEvent(event: AppEvent): event is Extract<AppEvent, { type: "run_status" }> {
  if (event.type !== "run_status") return false
  return ["completed", "failed", "cancelled", "killed"].includes(event.status)
}

function threadIdFromEvent(event: AppEvent): string | null {
  if (!("thread_id" in event)) return null
  return typeof event.thread_id === "string" ? event.thread_id : null
}

function isAuthGate(gate: PendingGateInfo): boolean {
  return gate.gate_name === "auth"
}

function gateKey(gate: PendingGateInfo): string {
  return `${gate.run_id ?? ""}\n${gate.gate_ref ?? ""}`
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
      if (key.startsWith("work_summary_")) return key.slice("work_summary_".length).replaceAll("_", " ")
      if (key === "idle") return "thinking"
      return key ? key.replaceAll("_", " ") : "thinking"
  }
}

function uiStatusKey(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

async function readSkillDetail(skill: SkillListItem, path: string | null): Promise<string> {
  if (skill.content) return skill.content
  if (!path) throw new Error("Reborn CLI did not return enough metadata to locate SKILL.md.")
  return Bun.file(path).text()
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
