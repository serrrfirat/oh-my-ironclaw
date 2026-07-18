import { spawn } from "node:child_process"
import { SyntaxStyle, type KeyEvent, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from "@opentui/react"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import type { ClientConfig } from "../config"
import { GatewayClient } from "../gateway/client"
import type {
  AccountTracesResponse,
  AppEvent,
  AutomationInfo,
  ConnectableChannelInfo,
  ExtensionInfo,
  ExtensionRegistryEntry,
  ExtensionSetupResponse,
  FsMountInfo,
  HistoryResponse,
  LlmConfigSnapshot,
  LlmProviderView,
  LogEntry,
  NearAiAuthProvider,
  NearAiWalletLoginRequest,
  OutboundDeliveryTargetOption,
  OutboundPreferencesResponse,
  PendingGateInfo,
  ProjectFsEntry,
  ProjectFsStat,
  ProjectInfo,
  ProjectMemberInfo,
  SkillInfo,
  ThreadInfo,
  TraceCreditsResponse,
} from "../gateway/types"
import { parseModelListResponse, selectedModelFromSwitchResponse, withSelectedModel } from "../modelCommands"
import { activeProfileFromCliResult, shouldUseLocalDevYoloSplash } from "../rebornProfile"
import { formatLocalCliResult, formatRebornCliCommand, runRebornCli } from "../rebornCli"
import { filterSkills, parseSkillListOutput, skillDetailPath, type SkillListItem, type SkillListResult } from "../skillList"
import { initialUiState, reduceUiState, type ActivityItem } from "../state"
import { filterThreads, sortThreadsByRecent, threadPreviewFromHistory, type ThreadPreviewMap } from "../threadPreviews"
import { AutomationsSurface } from "./AutomationsSurface"
import { ChannelsSurface } from "./ChannelsSurface"
import { ExtensionsSurface, extensionRows, type ExtensionRow } from "./ExtensionsSurface"
import { LlmProvidersSurface, type LlmProviderFormView } from "./LlmProvidersSurface"
import { ConversationSurface, WelcomeSurface, type ComposerCommonProps, type GateAction } from "./MainSurfaces"
import { SettingsSurface, SETTINGS_SECTION_COUNT, settingsSectionAt } from "./SettingsSurface"
import { SkillsSurface, type SkillDetailView } from "./SkillsSurface"
import { SkillsRemoteSurface, type RemoteSkillDetail, type SkillInstallState } from "./SkillsRemoteSurface"
import { LogsSurface } from "./LogsSurface"
import { TracesSurface } from "./TracesSurface"
import { WorkspaceSurface, type WorkspaceView } from "./WorkspaceSurface"
import { ProjectsSurface, type ProjectsView } from "./ProjectsSurface"
import { ToolsSurface } from "./ToolsSurface"
import { OutboundSurface } from "./OutboundSurface"
import { theme, accentRamp } from "./theme"
import {
  attachmentBudget,
  basename,
  mimeFromExtension,
  toOutgoingAttachment,
  validateStagedAttachment,
  type StagedAttachment,
} from "./attachments"
import { buildLogQuery, cycleLogLevel, DEFAULT_LOG_FILTER, type LogFilterState } from "./logFilters"
import { nextToolPermission, toolPermissionRows, type ToolPermissionRow } from "./toolPermissions"
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

type ActiveOverlay =
  | "automations"
  | "channels"
  | "commands"
  | "extensions"
  | "threads"
  | "models"
  | "providers"
  | "settings"
  | "skills"
  | "skills-remote"
  | "logs"
  | "traces"
  | "workspace"
  | "projects"
  | "tools"
  | "outbound"
  | null
type LlmProviderFormMode = "create" | "edit"
type LlmProviderFormField = "name" | "id" | "adapter" | "baseUrl" | "model" | "apiKey"
type LlmProviderFormState = {
  mode: LlmProviderFormMode
  providerId?: string
  fields: LlmProviderFormField[]
  index: number
  input: string
  values: Partial<Record<LlmProviderFormField, string>>
  defaults: Partial<Record<LlmProviderFormField, string>>
}
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
  const lastSelectedTextRef = useRef("")
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
  const [threadDeleteConfirm, setThreadDeleteConfirm] = useState(false)
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
  const [automations, setAutomations] = useState<AutomationInfo[]>([])
  const [automationsLoading, setAutomationsLoading] = useState(false)
  const [automationsError, setAutomationsError] = useState<string | null>(null)
  const [selectedAutomationIndex, setSelectedAutomationIndex] = useState(0)
  const [automationRenameActive, setAutomationRenameActive] = useState(false)
  const [automationRenameInput, setAutomationRenameInput] = useState("")
  const [automationConfirmDelete, setAutomationConfirmDelete] = useState(false)
  const [automationMessage, setAutomationMessage] = useState<string | null>(null)
  const [channels, setChannels] = useState<ConnectableChannelInfo[]>([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [channelsError, setChannelsError] = useState<string | null>(null)
  const [selectedChannelIndex, setSelectedChannelIndex] = useState(0)
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])
  const [extensionRegistry, setExtensionRegistry] = useState<ExtensionRegistryEntry[]>([])
  const [extensionsLoading, setExtensionsLoading] = useState(false)
  const [extensionsError, setExtensionsError] = useState<string | null>(null)
  const [extensionActionMessage, setExtensionActionMessage] = useState<string | null>(null)
  const [selectedExtensionIndex, setSelectedExtensionIndex] = useState(0)
  const [extensionSetup, setExtensionSetup] = useState<ExtensionSetupResponse | null>(null)
  const [extensionSetupInput, setExtensionSetupInput] = useState("")
  const [extensionSetupInputKey, setExtensionSetupInputKey] = useState<string | null>(null)
  const [llmConfig, setLlmConfig] = useState<LlmConfigSnapshot | null>(null)
  const [llmConfigError, setLlmConfigError] = useState<string | null>(null)
  const [llmProvidersLoading, setLlmProvidersLoading] = useState(false)
  const [llmProviderActionMessage, setLlmProviderActionMessage] = useState<string | null>(null)
  const [llmProviderModels, setLlmProviderModels] = useState<string[]>([])
  const [llmProviderSetupInput, setLlmProviderSetupInput] = useState("")
  const [llmProviderSetupInputKey, setLlmProviderSetupInputKey] = useState<string | null>(null)
  const [nearAiWalletInput, setNearAiWalletInput] = useState("")
  const [nearAiWalletInputActive, setNearAiWalletInputActive] = useState(false)
  const [llmProviderForm, setLlmProviderForm] = useState<LlmProviderFormState | null>(null)
  const [selectedLlmProviderIndex, setSelectedLlmProviderIndex] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  // --- Attachments staged for the next send ---
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([])
  // --- Remote skills surface ---
  const [remoteSkills, setRemoteSkills] = useState<SkillInfo[]>([])
  const [remoteSkillQuery, setRemoteSkillQuery] = useState("")
  const [remoteSkillSearching, setRemoteSkillSearching] = useState(false)
  const [remoteSkillIndex, setRemoteSkillIndex] = useState(0)
  const [remoteSkillDetail, setRemoteSkillDetail] = useState<RemoteSkillDetail | null>(null)
  const [skillInstall, setSkillInstall] = useState<SkillInstallState | null>(null)
  const [remoteSkillConfirmRemove, setRemoteSkillConfirmRemove] = useState(false)
  const [remoteSkillsLoading, setRemoteSkillsLoading] = useState(false)
  const [remoteSkillsError, setRemoteSkillsError] = useState<string | null>(null)
  const [remoteSkillMessage, setRemoteSkillMessage] = useState<string | null>(null)
  const [autoActivateLearned, setAutoActivateLearned] = useState(false)
  // --- Logs surface ---
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [logFilter, setLogFilter] = useState<LogFilterState>(DEFAULT_LOG_FILTER)
  const [logSource, setLogSource] = useState("")
  const [logTailSupported, setLogTailSupported] = useState(false)
  const [logFollowSupported, setLogFollowSupported] = useState(false)
  const [logCursor, setLogCursor] = useState<string | null>(null)
  const [logEditingTarget, setLogEditingTarget] = useState(false)
  const [logTargetInput, setLogTargetInput] = useState("")
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  // --- Traces surface ---
  const [traceCredits, setTraceCredits] = useState<TraceCreditsResponse | null>(null)
  const [traceAccount, setTraceAccount] = useState<AccountTracesResponse | null>(null)
  const [traceLoginLink, setTraceLoginLink] = useState<string | null>(null)
  const [selectedHoldIndex, setSelectedHoldIndex] = useState(0)
  const [tracesLoading, setTracesLoading] = useState(false)
  const [tracesError, setTracesError] = useState<string | null>(null)
  const [traceMessage, setTraceMessage] = useState<string | null>(null)
  // --- Workspace surface ---
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>({ kind: "mounts" })
  const [fsMounts, setFsMounts] = useState<FsMountInfo[]>([])
  const [fsEntries, setFsEntries] = useState<ProjectFsEntry[]>([])
  const [fsStat, setFsStat] = useState<ProjectFsStat | null>(null)
  const [fsFileContent, setFsFileContent] = useState<string | null>(null)
  const [fsFileOffset, setFsFileOffset] = useState(0)
  const [fsSelectedIndex, setFsSelectedIndex] = useState(0)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  // --- Projects surface ---
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [projectMembers, setProjectMembers] = useState<ProjectMemberInfo[]>([])
  const [projectsView, setProjectsView] = useState<ProjectsView>("list")
  const [selectedProjectIndex, setSelectedProjectIndex] = useState(0)
  const [projectCreateInput, setProjectCreateInput] = useState("")
  const [projectConfirmDelete, setProjectConfirmDelete] = useState(false)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectMessage, setProjectMessage] = useState<string | null>(null)
  // --- Tools (settings/tools) surface ---
  const [toolRows, setToolRows] = useState<ToolPermissionRow[]>([])
  const [toolsGlobalAutoApprove, setToolsGlobalAutoApprove] = useState(false)
  const [selectedToolIndex, setSelectedToolIndex] = useState(0)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [toolsMessage, setToolsMessage] = useState<string | null>(null)
  // --- Outbound surface ---
  const [outboundPrefs, setOutboundPrefs] = useState<OutboundPreferencesResponse | null>(null)
  const [outboundTargets, setOutboundTargets] = useState<OutboundDeliveryTargetOption[]>([])
  const [selectedOutboundIndex, setSelectedOutboundIndex] = useState(0)
  const [outboundLoading, setOutboundLoading] = useState(false)
  const [outboundError, setOutboundError] = useState<string | null>(null)
  const [outboundMessage, setOutboundMessage] = useState<string | null>(null)
  const activityFrame = useActivityFrame(state.isThinking)
  const thinkingLabel = thinkingLabelForActivity(state.activity, state.status, state.isThinking)
  const showCommandPalette = activeOverlay === "commands"
  const showAutomations = activeOverlay === "automations"
  const showChannels = activeOverlay === "channels"
  const showExtensions = activeOverlay === "extensions"
  const showThreadPalette = activeOverlay === "threads"
  const showModelPalette = activeOverlay === "models"
  const showLlmProviders = activeOverlay === "providers"
  const showSettings = activeOverlay === "settings"
  const showSkills = activeOverlay === "skills"
  const showRemoteSkills = activeOverlay === "skills-remote"
  const showLogs = activeOverlay === "logs"
  const showTraces = activeOverlay === "traces"
  const showWorkspace = activeOverlay === "workspace"
  const showProjects = activeOverlay === "projects"
  const showTools = activeOverlay === "tools"
  const showOutbound = activeOverlay === "outbound"
  const operatorOnly = state.session ? !state.session.capabilities.operator_webui_config : false
  const projectsEnabled = Boolean(state.session?.features.reborn_projects)
  const filteredRemoteSkills = useMemo(
    () => filterRemoteSkills(remoteSkills, remoteSkillQuery),
    [remoteSkills, remoteSkillQuery],
  )
  const commandSet = useMemo(() => slashCommandsForMode(config.mode), [config.mode])
  const slashCommands = showCommandPalette ? commandSet : filteredSlashCommands(input, commandSet)
  const filteredThreadList = useMemo(() => filterThreads(paletteThreads, threadSearch, threadPreviews), [paletteThreads, threadSearch, threadPreviews])
  const filteredSkillList = useMemo(() => filterSkills(skillList.skills, skillSearch), [skillList.skills, skillSearch])
  const extensionList = useMemo(() => extensionRows(extensions, extensionRegistry), [extensions, extensionRegistry])
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

  useSelectionHandler((selection) => {
    const selectedText = selection.getSelectedText()
    if (!selectedText) return
    lastSelectedTextRef.current = selectedText
    copyTextToClipboard(selectedText)
  })

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }
    if (isCommandCopy(key)) {
      key.preventDefault()
      key.stopPropagation()
      copyTextToClipboard(lastSelectedTextRef.current || textareaRef.current?.plainText || input)
      return
    }
    if (showAutomations) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        if (automationRenameActive) setAutomationRenameActive(false)
        else if (automationConfirmDelete) setAutomationConfirmDelete(false)
        else setActiveOverlay(null)
        return
      }
      if (automationRenameActive) {
        if (key.name === "backspace" || key.name === "delete") { key.preventDefault(); key.stopPropagation(); setAutomationRenameInput((v) => v.slice(0, -1)); return }
        if (key.ctrl && key.name === "u") { key.preventDefault(); key.stopPropagation(); setAutomationRenameInput(""); return }
        if (isPlainEnter(key)) { key.preventDefault(); key.stopPropagation(); void submitAutomationRename(); return }
        const text = printableKeyText(key)
        if (text) { key.preventDefault(); key.stopPropagation(); setAutomationRenameInput((v) => v + text); return }
        return
      }
      if (automationConfirmDelete) {
        const answer = printableKeyText(key).toLowerCase()
        if (answer === "y") { key.preventDefault(); key.stopPropagation(); void deleteSelectedAutomation(); return }
        if (answer === "n") { key.preventDefault(); key.stopPropagation(); setAutomationConfirmDelete(false); return }
        return
      }
      if (key.name === "up" || key.name === "k") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedAutomationIndex((index) => wrapIndex(index - 1, automations.length))
        return
      }
      if (key.name === "down" || key.name === "tab" || key.name === "j") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedAutomationIndex((index) => wrapIndex(index + 1, automations.length))
        return
      }
      const automationKey = printableKeyText(key).toLowerCase()
      if (automationKey === "p") { key.preventDefault(); key.stopPropagation(); void pauseSelectedAutomation(); return }
      if (automationKey === "r") { key.preventDefault(); key.stopPropagation(); void resumeSelectedAutomation(); return }
      if (automationKey === "n") { key.preventDefault(); key.stopPropagation(); setAutomationRenameInput(selectedAutomation()?.name ?? ""); setAutomationRenameActive(true); return }
      if (automationKey === "d") { key.preventDefault(); key.stopPropagation(); if (automations.length) setAutomationConfirmDelete(true); return }
      if (automationKey === "g") { key.preventDefault(); key.stopPropagation(); void loadAutomations(); return }
      return
    }
    if (showChannels) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        setActiveOverlay(null)
        return
      }
      if (key.name === "up" || key.name === "k") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedChannelIndex((index) => wrapIndex(index - 1, channels.length))
        return
      }
      if (key.name === "down" || key.name === "tab" || key.name === "j") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedChannelIndex((index) => wrapIndex(index + 1, channels.length))
        return
      }
      if (printableKeyText(key).toLowerCase() === "r") {
        key.preventDefault()
        key.stopPropagation()
        void loadChannels()
        return
      }
      return
    }
    if (showExtensions) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        if (extensionSetupInputKey) {
          setExtensionSetupInputKey(null)
          setExtensionSetupInput("")
        } else {
          setActiveOverlay(null)
        }
        return
      }
      if (extensionSetupInputKey) {
        if (key.name === "backspace" || key.name === "delete") {
          key.preventDefault()
          key.stopPropagation()
          setExtensionSetupInput((value) => value.slice(0, -1))
          return
        }
        if (key.ctrl && key.name === "u") {
          key.preventDefault()
          key.stopPropagation()
          setExtensionSetupInput("")
          return
        }
        if (isPlainEnter(key)) {
          key.preventDefault()
          key.stopPropagation()
          void submitSelectedExtensionSetup()
          return
        }
        const text = printableKeyText(key)
        if (text) {
          key.preventDefault()
          key.stopPropagation()
          setExtensionSetupInput((value) => value + text)
          return
        }
        return
      }
      if (key.name === "up" || key.name === "k") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedExtensionIndex((index) => wrapIndex(index - 1, extensionList.length))
        setExtensionSetup(null)
        return
      }
      if (key.name === "down" || key.name === "tab" || key.name === "j") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedExtensionIndex((index) => wrapIndex(index + 1, extensionList.length))
        setExtensionSetup(null)
        return
      }
      const text = printableKeyText(key).toLowerCase()
      if (text === "r") {
        key.preventDefault()
        key.stopPropagation()
        void loadExtensions()
        return
      }
      if (text === "s") {
        key.preventDefault()
        key.stopPropagation()
        void loadSelectedExtensionSetup()
        return
      }
      if (text === "x") {
        key.preventDefault()
        key.stopPropagation()
        void removeSelectedExtension()
        return
      }
      if (isPlainEnter(key)) {
        key.preventDefault()
        key.stopPropagation()
        void runSelectedExtensionDefaultAction()
        return
      }
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
    if (showLlmProviders) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        if (nearAiWalletInputActive) {
          setNearAiWalletInputActive(false)
          setNearAiWalletInput("")
        } else if (llmProviderSetupInputKey) {
          setLlmProviderSetupInputKey(null)
          setLlmProviderSetupInput("")
        } else if (llmProviderForm) {
          setLlmProviderForm(null)
        } else {
          setActiveOverlay(null)
        }
        return
      }
      if (nearAiWalletInputActive) {
        if (key.name === "backspace" || key.name === "delete") {
          key.preventDefault()
          key.stopPropagation()
          setNearAiWalletInput((value) => value.slice(0, -1))
          return
        }
        if (key.ctrl && key.name === "u") {
          key.preventDefault()
          key.stopPropagation()
          setNearAiWalletInput("")
          return
        }
        if (isPlainEnter(key)) {
          key.preventDefault()
          key.stopPropagation()
          void submitNearAiWalletLogin()
          return
        }
        const inputText = printableKeyText(key)
        if (inputText) {
          key.preventDefault()
          key.stopPropagation()
          setNearAiWalletInput((value) => value + inputText)
          return
        }
        return
      }
      if (llmProviderForm) {
        if (key.name === "backspace" || key.name === "delete") {
          key.preventDefault()
          key.stopPropagation()
          setLlmProviderForm((form) => form ? { ...form, input: form.input.slice(0, -1) } : form)
          return
        }
        if (key.ctrl && key.name === "u") {
          key.preventDefault()
          key.stopPropagation()
          setLlmProviderForm((form) => form ? { ...form, input: "" } : form)
          return
        }
        if (isPlainEnter(key)) {
          key.preventDefault()
          key.stopPropagation()
          void submitLlmProviderFormStep()
          return
        }
        const inputText = printableKeyText(key)
        if (inputText) {
          key.preventDefault()
          key.stopPropagation()
          setLlmProviderForm((form) => form ? { ...form, input: form.input + inputText } : form)
          return
        }
        return
      }
      if (llmProviderSetupInputKey) {
        if (key.name === "backspace" || key.name === "delete") {
          key.preventDefault()
          key.stopPropagation()
          setLlmProviderSetupInput((value) => value.slice(0, -1))
          return
        }
        if (key.ctrl && key.name === "u") {
          key.preventDefault()
          key.stopPropagation()
          setLlmProviderSetupInput("")
          return
        }
        if (isPlainEnter(key)) {
          key.preventDefault()
          key.stopPropagation()
          void submitSelectedLlmProviderSetup()
          return
        }
        const inputText = printableKeyText(key)
        if (inputText) {
          key.preventDefault()
          key.stopPropagation()
          setLlmProviderSetupInput((value) => value + inputText)
          return
        }
        return
      }
      if (key.name === "up" || key.name === "k") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedLlmProviderIndex((index) => wrapIndex(index - 1, llmProviders().length))
        setLlmProviderModels([])
        setLlmProviderSetupInputKey(null)
        setLlmProviderForm(null)
        setNearAiWalletInputActive(false)
        setNearAiWalletInput("")
        return
      }
      if (key.name === "down" || key.name === "tab" || key.name === "j") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedLlmProviderIndex((index) => wrapIndex(index + 1, llmProviders().length))
        setLlmProviderModels([])
        setLlmProviderSetupInputKey(null)
        setLlmProviderForm(null)
        setNearAiWalletInputActive(false)
        setNearAiWalletInput("")
        return
      }
      const text = printableKeyText(key).toLowerCase()
      if (text === "r") {
        key.preventDefault()
        key.stopPropagation()
        void loadLlmConfig()
        return
      }
      if (text === "t") {
        key.preventDefault()
        key.stopPropagation()
        void testSelectedLlmProvider()
        return
      }
      if (text === "l") {
        key.preventDefault()
        key.stopPropagation()
        void startSelectedLlmProviderLogin("github")
        return
      }
      if (text === "g") {
        key.preventDefault()
        key.stopPropagation()
        void startSelectedLlmProviderLogin("google")
        return
      }
      if (text === "w") {
        key.preventDefault()
        key.stopPropagation()
        openNearAiWalletLogin()
        return
      }
      if (text === "s") {
        key.preventDefault()
        key.stopPropagation()
        openSelectedLlmProviderSetup()
        return
      }
      if (text === "n") {
        key.preventDefault()
        key.stopPropagation()
        openNewLlmProviderForm()
        return
      }
      if (text === "e") {
        key.preventDefault()
        key.stopPropagation()
        openEditLlmProviderForm()
        return
      }
      if (text === "x") {
        key.preventDefault()
        key.stopPropagation()
        void deleteSelectedLlmProvider()
        return
      }
      if (text === "m") {
        key.preventDefault()
        key.stopPropagation()
        void listSelectedLlmProviderModels()
        return
      }
      if (isPlainEnter(key)) {
        key.preventDefault()
        key.stopPropagation()
        void setSelectedLlmProviderActive()
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
        void openSelectedSettingsSection()
        return
      }
      return
    }
    if (showRemoteSkills) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        if (remoteSkillSearching) setRemoteSkillSearching(false)
        else if (skillInstall) setSkillInstall(null)
        else if (remoteSkillDetail) setRemoteSkillDetail(null)
        else if (remoteSkillConfirmRemove) setRemoteSkillConfirmRemove(false)
        else setActiveOverlay(null)
        return
      }
      if (skillInstall) {
        if (key.name === "backspace" || key.name === "delete") {
          key.preventDefault(); key.stopPropagation()
          setSkillInstall((s) => (s ? { ...s, [s.step]: s[s.step].slice(0, -1) } : s))
          return
        }
        if (key.ctrl && key.name === "u") {
          key.preventDefault(); key.stopPropagation()
          setSkillInstall((s) => (s ? { ...s, [s.step]: "" } : s))
          return
        }
        if (isPlainEnter(key)) { key.preventDefault(); key.stopPropagation(); void submitSkillInstallStep(); return }
        const text = printableKeyText(key)
        if (text) { key.preventDefault(); key.stopPropagation(); setSkillInstall((s) => (s ? { ...s, [s.step]: s[s.step] + text } : s)); return }
        return
      }
      if (remoteSkillDetail) {
        if (key.name === "up" || key.name === "k") { key.preventDefault(); key.stopPropagation(); setRemoteSkillDetail((d) => (d ? { ...d, offset: Math.max(0, d.offset - 1) } : d)); return }
        if (key.name === "down" || key.name === "j") { key.preventDefault(); key.stopPropagation(); setRemoteSkillDetail((d) => (d ? { ...d, offset: d.offset + 1 } : d)); return }
        return
      }
      if (remoteSkillSearching) {
        if (key.name === "backspace" || key.name === "delete") { key.preventDefault(); key.stopPropagation(); setRemoteSkillQuery((q) => q.slice(0, -1)); setRemoteSkillIndex(0); return }
        if (key.ctrl && key.name === "u") { key.preventDefault(); key.stopPropagation(); setRemoteSkillQuery(""); setRemoteSkillIndex(0); return }
        if (isPlainEnter(key)) { key.preventDefault(); key.stopPropagation(); void searchRemoteSkills(remoteSkillQuery); setRemoteSkillSearching(false); return }
        const text = printableKeyText(key)
        if (text) { key.preventDefault(); key.stopPropagation(); setRemoteSkillQuery((q) => q + text); setRemoteSkillIndex(0); return }
        return
      }
      if (remoteSkillConfirmRemove) {
        const answer = printableKeyText(key).toLowerCase()
        if (answer === "y") { key.preventDefault(); key.stopPropagation(); void removeSelectedRemoteSkill(); return }
        if (answer === "n") { key.preventDefault(); key.stopPropagation(); setRemoteSkillConfirmRemove(false); return }
        return
      }
      if (key.name === "up" || key.name === "k") { key.preventDefault(); key.stopPropagation(); setRemoteSkillIndex((i) => wrapIndex(i - 1, filteredRemoteSkills.length)); return }
      if (key.name === "down" || key.name === "j" || key.name === "tab") { key.preventDefault(); key.stopPropagation(); setRemoteSkillIndex((i) => wrapIndex(i + 1, filteredRemoteSkills.length)); return }
      if (isPlainEnter(key)) { key.preventDefault(); key.stopPropagation(); void openRemoteSkillDetail(); return }
      const skillKey = printableKeyText(key)
      if (skillKey === "/") { key.preventDefault(); key.stopPropagation(); setRemoteSkillSearching(true); return }
      if (skillKey === "i") { key.preventDefault(); key.stopPropagation(); setSkillInstall({ step: "name", name: "", content: "" }); return }
      if (skillKey === "x") { key.preventDefault(); key.stopPropagation(); setRemoteSkillConfirmRemove(true); return }
      if (skillKey === "a") { key.preventDefault(); key.stopPropagation(); void toggleSelectedSkillAutoActivate(); return }
      if (skillKey === "L") { key.preventDefault(); key.stopPropagation(); void toggleLearnedAutoActivate(); return }
      return
    }
    if (showLogs) {
      if (key.name === "escape") {
        key.preventDefault(); key.stopPropagation()
        if (logEditingTarget) { setLogEditingTarget(false); setLogTargetInput("") } else setActiveOverlay(null)
        return
      }
      if (logEditingTarget) {
        if (key.name === "backspace" || key.name === "delete") { key.preventDefault(); key.stopPropagation(); setLogTargetInput((v) => v.slice(0, -1)); return }
        if (key.ctrl && key.name === "u") { key.preventDefault(); key.stopPropagation(); setLogTargetInput(""); return }
        if (isPlainEnter(key)) {
          key.preventDefault(); key.stopPropagation()
          const nextFilter = { ...logFilter, target: logTargetInput }
          setLogFilter(nextFilter); setLogEditingTarget(false)
          void loadLogs(nextFilter, true)
          return
        }
        const text = printableKeyText(key)
        if (text) { key.preventDefault(); key.stopPropagation(); setLogTargetInput((v) => v + text); return }
        return
      }
      const logKey = printableKeyText(key).toLowerCase()
      if (logKey === "l") { key.preventDefault(); key.stopPropagation(); const nextFilter = { ...logFilter, level: cycleLogLevel(logFilter.level, 1) }; setLogFilter(nextFilter); void loadLogs(nextFilter, true); return }
      if (logKey === "t") { key.preventDefault(); key.stopPropagation(); setLogEditingTarget(true); setLogTargetInput(logFilter.target ?? ""); return }
      if (logKey === "f") { key.preventDefault(); key.stopPropagation(); const nextFilter = { ...logFilter, follow: !logFilter.follow }; setLogFilter(nextFilter); void loadLogs(nextFilter, true); return }
      if (logKey === "o") { key.preventDefault(); key.stopPropagation(); void loadOlderLogs(); return }
      if (logKey === "r") { key.preventDefault(); key.stopPropagation(); void loadLogs(logFilter, true); return }
      return
    }
    if (showTraces) {
      if (key.name === "escape") { key.preventDefault(); key.stopPropagation(); setActiveOverlay(null); return }
      if (key.name === "up" || key.name === "k") { key.preventDefault(); key.stopPropagation(); setSelectedHoldIndex((i) => wrapIndex(i - 1, traceCredits?.holds.length ?? 0)); return }
      if (key.name === "down" || key.name === "j") { key.preventDefault(); key.stopPropagation(); setSelectedHoldIndex((i) => wrapIndex(i + 1, traceCredits?.holds.length ?? 0)); return }
      const traceKey = printableKeyText(key)
      if (traceKey === "a") { key.preventDefault(); key.stopPropagation(); void authorizeSelectedHold(); return }
      if (traceKey === "L") { key.preventDefault(); key.stopPropagation(); void fetchAccountLoginLink(); return }
      if (traceKey.toLowerCase() === "r") { key.preventDefault(); key.stopPropagation(); void loadTraces(); return }
      return
    }
    if (showWorkspace) {
      if (key.name === "escape") { key.preventDefault(); key.stopPropagation(); setActiveOverlay(null); return }
      if (workspaceView.kind === "file") {
        if (key.name === "up" || key.name === "k") { key.preventDefault(); key.stopPropagation(); setFsFileOffset((o) => Math.max(0, o - 1)); return }
        if (key.name === "down" || key.name === "j") { key.preventDefault(); key.stopPropagation(); setFsFileOffset((o) => o + 1); return }
        if (key.name === "backspace") { key.preventDefault(); key.stopPropagation(); void fsGoUp(); return }
        return
      }
      const listLength = workspaceView.kind === "mounts" ? fsMounts.length : fsEntries.length
      if (key.name === "up" || key.name === "k") { key.preventDefault(); key.stopPropagation(); setFsSelectedIndex((i) => wrapIndex(i - 1, listLength)); return }
      if (key.name === "down" || key.name === "j" || key.name === "tab") { key.preventDefault(); key.stopPropagation(); setFsSelectedIndex((i) => wrapIndex(i + 1, listLength)); return }
      if (key.name === "backspace") { key.preventDefault(); key.stopPropagation(); void fsGoUp(); return }
      if (isPlainEnter(key)) {
        key.preventDefault(); key.stopPropagation()
        if (workspaceView.kind === "mounts") {
          const mount = fsMounts[wrapIndex(fsSelectedIndex, fsMounts.length)]
          if (mount) void browseFs(mount.mount, "")
        } else {
          void openFsEntry()
        }
        return
      }
      return
    }
    if (showProjects) {
      if (key.name === "escape") {
        key.preventDefault(); key.stopPropagation()
        if (projectsView !== "list") { setProjectsView("list"); setProjectConfirmDelete(false) } else setActiveOverlay(null)
        return
      }
      if (projectsView === "create") {
        if (key.name === "backspace" || key.name === "delete") { key.preventDefault(); key.stopPropagation(); setProjectCreateInput((v) => v.slice(0, -1)); return }
        if (key.ctrl && key.name === "u") { key.preventDefault(); key.stopPropagation(); setProjectCreateInput(""); return }
        if (isPlainEnter(key)) { key.preventDefault(); key.stopPropagation(); void createProjectFromInput(); return }
        const text = printableKeyText(key)
        if (text) { key.preventDefault(); key.stopPropagation(); setProjectCreateInput((v) => v + text); return }
        return
      }
      if (projectsView === "members") return
      if (projectConfirmDelete) {
        const answer = printableKeyText(key).toLowerCase()
        if (answer === "y") { key.preventDefault(); key.stopPropagation(); void deleteSelectedProject(); return }
        if (answer === "n") { key.preventDefault(); key.stopPropagation(); setProjectConfirmDelete(false); return }
        return
      }
      if (key.name === "up" || key.name === "k") { key.preventDefault(); key.stopPropagation(); setSelectedProjectIndex((i) => wrapIndex(i - 1, projects.length)); return }
      if (key.name === "down" || key.name === "j" || key.name === "tab") { key.preventDefault(); key.stopPropagation(); setSelectedProjectIndex((i) => wrapIndex(i + 1, projects.length)); return }
      const projectKey = printableKeyText(key).toLowerCase()
      if (projectKey === "n") { key.preventDefault(); key.stopPropagation(); setProjectsView("create"); setProjectCreateInput(""); return }
      if (projectKey === "m") { key.preventDefault(); key.stopPropagation(); void openProjectMembersView(); return }
      if (projectKey === "d") { key.preventDefault(); key.stopPropagation(); setProjectConfirmDelete(true); return }
      if (projectKey === "r") { key.preventDefault(); key.stopPropagation(); void loadProjects(); return }
      return
    }
    if (showTools) {
      if (key.name === "escape") { key.preventDefault(); key.stopPropagation(); setActiveOverlay(null); return }
      if (key.name === "up" || key.name === "k") { key.preventDefault(); key.stopPropagation(); setSelectedToolIndex((i) => wrapIndex(i - 1, toolRows.length)); return }
      if (key.name === "down" || key.name === "j" || key.name === "tab") { key.preventDefault(); key.stopPropagation(); setSelectedToolIndex((i) => wrapIndex(i + 1, toolRows.length)); return }
      if (isPlainEnter(key)) { key.preventDefault(); key.stopPropagation(); void cycleSelectedToolPermission(); return }
      const toolKey = printableKeyText(key).toLowerCase()
      if (toolKey === "g") { key.preventDefault(); key.stopPropagation(); void toggleGlobalAutoApprove(); return }
      if (toolKey === "r") { key.preventDefault(); key.stopPropagation(); void loadTools(); return }
      return
    }
    if (showOutbound) {
      if (key.name === "escape") { key.preventDefault(); key.stopPropagation(); setActiveOverlay(null); return }
      if (key.name === "up" || key.name === "k") { key.preventDefault(); key.stopPropagation(); setSelectedOutboundIndex((i) => wrapIndex(i - 1, outboundTargets.length)); return }
      if (key.name === "down" || key.name === "j" || key.name === "tab") { key.preventDefault(); key.stopPropagation(); setSelectedOutboundIndex((i) => wrapIndex(i + 1, outboundTargets.length)); return }
      if (isPlainEnter(key)) { key.preventDefault(); key.stopPropagation(); void setSelectedOutboundTarget(); return }
      const outKey = printableKeyText(key).toLowerCase()
      if (outKey === "c") { key.preventDefault(); key.stopPropagation(); void clearOutboundTarget(); return }
      if (outKey === "r") { key.preventDefault(); key.stopPropagation(); void loadOutbound(); return }
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
        if (threadDeleteConfirm) setThreadDeleteConfirm(false)
        else setActiveOverlay(null)
        return
      }
      if (threadDeleteConfirm) {
        const answer = printableKeyText(key).toLowerCase()
        if (answer === "y") { key.preventDefault(); key.stopPropagation(); setThreadDeleteConfirm(false); void deleteSelectedThread(); return }
        if (answer === "n") { key.preventDefault(); key.stopPropagation(); setThreadDeleteConfirm(false); return }
        return
      }
      if (key.ctrl && key.name === "d") {
        key.preventDefault(); key.stopPropagation()
        if (filteredThreadList.length) setThreadDeleteConfirm(true)
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
      if (isOauthGate(state.pendingGate) || hasAuthorizationUrl(state.pendingGate)) {
        const text = printableKeyText(key).toLowerCase()
        if (text === "o") {
          key.preventDefault()
          key.stopPropagation()
          void openAuthUrl(state.pendingGate)
          return
        }
      }
      if (!isManualTokenGate(state.pendingGate)) return
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
    if (state.pendingGate && !isAuthGate(state.pendingGate)) {
      if (printableKeyText(key).toLowerCase() === "w" && state.pendingGate.allow_always) {
        key.preventDefault()
        key.stopPropagation()
        void resolveGate("always")
        return
      }
      if (key.name === "left" || key.name === "right" || key.name === "tab") {
        const cycle: GateAction[] = state.pendingGate.allow_always ? ["approved", "always", "denied"] : ["approved", "denied"]
        setSelectedGateAction((action) => cycle[wrapIndex(cycle.indexOf(action) + 1, cycle.length)] ?? "approved")
        return
      }
      if (key.name === "return" || key.name === "kpenter" || key.name === "linefeed") {
        void resolveGate(selectedGateAction)
        return
      }
    }
    if (key.ctrl && key.name === "r") {
      key.preventDefault()
      key.stopPropagation()
      void retryLastRun()
      return
    }
    if (key.ctrl && key.name === "g") {
      key.preventDefault()
      key.stopPropagation()
      void jumpToApprovalInbox()
      return
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
    if (isCommandSpace(key)) {
      key.preventDefault()
      key.stopPropagation()
      clearComposer()
      return
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
      while (!cancelled) {
        try {
          await client.health()
          if (cancelled) return
          dispatch({ type: "connected", connected: true, status: "connected" })
          void client.session().then(
            (session) => {
              if (!cancelled) dispatch({ type: "session", session })
            },
            () => {},
          )
          await startNewThreadOnConnect()
          return
        } catch (error) {
          if (cancelled) return
          dispatch({ type: "connected", connected: false, status: "reconnecting" })
          dispatch({ type: "error", message: errorMessage(error) })
          await sleep(1500)
        }
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [client])

  useEffect(() => {
    if (state.connected) return
    let cancelled = false

    async function checkConnection() {
      try {
        await client.health()
        if (!cancelled) dispatch({ type: "connected", connected: true, status: "connected" })
      } catch {
        // Boot and SSE loops surface detailed errors; this watchdog only repairs stale disconnected state.
      }
    }

    void checkConnection()
    const timer = setInterval(() => void checkConnection(), 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [client, state.connected])

  // Poll the approval inbox for the status-bar badge.
  useEffect(() => {
    if (!state.connected) return
    let cancelled = false
    async function pollInbox() {
      try {
        const inbox = await client.approvalInbox()
        if (!cancelled) dispatch({ type: "approval_count", count: inbox.count })
      } catch {
        // ignore; badge stays at its last value
      }
    }
    void pollInbox()
    const timer = setInterval(() => void pollInbox(), 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [client, state.connected])

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

  async function openAutomationsOverlay() {
    setActiveOverlay("automations")
    setAutomationRenameActive(false)
    setAutomationConfirmDelete(false)
    setAutomationMessage(null)
    await loadAutomations()
  }

  async function loadAutomations() {
    setAutomationsLoading(true)
    setAutomationsError(null)
    try {
      const response = await client.automations()
      setAutomations(response.automations ?? [])
      setSelectedAutomationIndex((index) => wrapIndex(index, response.automations?.length ?? 0))
    } catch (error) {
      setAutomations([])
      setAutomationsError(errorMessage(error))
    } finally {
      setAutomationsLoading(false)
    }
  }

  function selectedAutomation(): AutomationInfo | null {
    return automations[wrapIndex(selectedAutomationIndex, automations.length)] ?? null
  }

  async function runAutomationMutation(label: string, action: () => Promise<unknown>) {
    setAutomationMessage(null)
    try {
      await action()
      setAutomationMessage(label)
      await loadAutomations()
    } catch (error) {
      setAutomationsError(errorMessage(error))
    }
  }

  async function pauseSelectedAutomation() {
    const automation = selectedAutomation()
    if (!automation) return
    await runAutomationMutation("paused", () => client.pauseAutomation(automation.automation_id))
  }

  async function resumeSelectedAutomation() {
    const automation = selectedAutomation()
    if (!automation) return
    await runAutomationMutation("resumed", () => client.resumeAutomation(automation.automation_id))
  }

  async function submitAutomationRename() {
    const automation = selectedAutomation()
    const name = automationRenameInput.trim()
    if (!automation || !name) {
      setAutomationRenameActive(false)
      return
    }
    setAutomationRenameActive(false)
    await runAutomationMutation("renamed", () => client.renameAutomation(automation.automation_id, name))
  }

  async function deleteSelectedAutomation() {
    const automation = selectedAutomation()
    if (!automation) return
    setAutomationConfirmDelete(false)
    await runAutomationMutation("deleted", () => client.deleteAutomation(automation.automation_id))
  }

  async function openChannelsOverlay() {
    setActiveOverlay("channels")
    await loadChannels()
  }

  async function loadChannels() {
    setChannelsLoading(true)
    setChannelsError(null)
    try {
      const response = await client.connectableChannels()
      setChannels(response.channels ?? [])
      setSelectedChannelIndex((index) => wrapIndex(index, response.channels?.length ?? 0))
    } catch (error) {
      setChannels([])
      setChannelsError(errorMessage(error))
    } finally {
      setChannelsLoading(false)
    }
  }

  async function openExtensionsOverlay() {
    setActiveOverlay("extensions")
    await loadExtensions()
  }

  async function loadExtensions() {
    setExtensionsLoading(true)
    setExtensionsError(null)
    setExtensionActionMessage(null)
    try {
      const [installed, registry] = await Promise.all([client.extensions(), client.extensionRegistry()])
      setExtensions(installed.extensions ?? [])
      setExtensionRegistry(registry.entries ?? [])
      setSelectedExtensionIndex((index) => wrapIndex(index, extensionRows(installed.extensions ?? [], registry.entries ?? []).length))
      setExtensionSetup(null)
      setExtensionSetupInput("")
      setExtensionSetupInputKey(null)
    } catch (error) {
      setExtensions([])
      setExtensionRegistry([])
      setExtensionsError(errorMessage(error))
    } finally {
      setExtensionsLoading(false)
    }
  }

  async function openSettingsOverlay() {
    setActiveOverlay("settings")
    await Promise.allSettled([loadLlmConfig(), loadExtensions(), loadAutomations(), loadChannels()])
  }

  async function openLlmProvidersOverlay() {
    setActiveOverlay("providers")
    setLlmProviderActionMessage(null)
    setLlmProviderModels([])
    setLlmProviderSetupInput("")
    setLlmProviderSetupInputKey(null)
    setLlmProviderForm(null)
    await loadLlmConfig()
  }

  async function loadLlmConfig() {
    setLlmProvidersLoading(true)
    setLlmConfigError(null)
    try {
      const snapshot = await client.llmConfig()
      setLlmConfig(snapshot)
      const active = snapshot.active
      if (active?.model) setSelectedModel(active.model)
      setSelectedLlmProviderIndex((index) => wrapIndex(index, snapshot.providers?.length ?? 0))
    } catch (error) {
      setLlmConfig(null)
      setLlmConfigError(errorMessage(error))
    } finally {
      setLlmProvidersLoading(false)
    }
  }

  function llmProviders(): LlmProviderView[] {
    return [...(llmConfig?.providers ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || (a.description || a.id).localeCompare(b.description || b.id))
  }

  function selectedLlmProvider(): LlmProviderView | null {
    const providers = llmProviders()
    return providers[wrapIndex(selectedLlmProviderIndex, providers.length)] ?? null
  }

  async function openSelectedSettingsSection() {
    switch (settingsSectionAt(selectedSettingsIndex)) {
      case "Providers":
        if (operatorOnly) {
          dispatch({ type: "notice", message: "LLM providers require the operator capability." })
          return
        }
        await openLlmProvidersOverlay()
        return
      case "Extensions":
        await openExtensionsOverlay()
        return
      case "Channels":
        await openChannelsOverlay()
        return
      case "Skills":
        if (config.mode === "local") await openSkillsPalette()
        else await openRemoteSkillsOverlay()
        return
      case "Automations":
        await openAutomationsOverlay()
        return
      case "Tools":
        await openToolsOverlay()
        return
      case "Outbound":
        await openOutboundOverlay()
        return
      default:
        return
    }
  }

  async function setSelectedLlmProviderActive() {
    const provider = selectedLlmProvider()
    if (!provider) return
    const model = provider.active_model || provider.default_model || selectedModel
    if (provider.api_key_required && !provider.api_key_set) {
      setLlmConfigError("Provider credentials are required before activation.")
      return
    }
    setLlmProvidersLoading(true)
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    try {
      const snapshot = await client.setActiveLlm(provider.id, model)
      setLlmConfig(snapshot)
      setSelectedModel(snapshot.active?.model || model)
      setLlmProviderActionMessage(`${provider.description || provider.id} is active.`)
    } catch (error) {
      setLlmConfigError(errorMessage(error))
    } finally {
      setLlmProvidersLoading(false)
    }
  }

  function openSelectedLlmProviderSetup() {
    const provider = selectedLlmProvider()
    if (!provider) return
    if (!provider.accepts_api_key && !provider.api_key_required) {
      setLlmConfigError("This provider does not accept an API key.")
      return
    }
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    setNearAiWalletInputActive(false)
    setNearAiWalletInput("")
    setLlmProviderSetupInput("")
    setLlmProviderSetupInputKey("api_key")
  }

  function openNearAiWalletLogin() {
    const provider = selectedLlmProvider()
    if (!provider) return
    if (provider.id !== "nearai" && provider.adapter !== "nearai") {
      setLlmConfigError("Wallet login is only available for NEAR AI.")
      return
    }
    setLlmConfigError(null)
    setLlmProviderActionMessage("Paste NEAR AI wallet login JSON, then press enter.")
    setLlmProviderSetupInputKey(null)
    setLlmProviderSetupInput("")
    setLlmProviderForm(null)
    setNearAiWalletInput("")
    setNearAiWalletInputActive(true)
  }

  function openNewLlmProviderForm() {
    const defaults: Partial<Record<LlmProviderFormField, string>> = {
      adapter: "open_ai_completions",
    }
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    setLlmProviderSetupInputKey(null)
    setLlmProviderSetupInput("")
    setNearAiWalletInputActive(false)
    setNearAiWalletInput("")
    setLlmProviderForm({
      mode: "create",
      fields: ["name", "id", "adapter", "baseUrl", "model", "apiKey"],
      index: 0,
      input: "",
      values: {},
      defaults,
    })
  }

  function openEditLlmProviderForm() {
    const provider = selectedLlmProvider()
    if (!provider) return
    const defaults: Partial<Record<LlmProviderFormField, string>> = {
      name: provider.description || provider.id,
      id: provider.id,
      adapter: provider.adapter,
      baseUrl: provider.base_url || "",
      model: provider.active_model || provider.default_model || selectedModel,
    }
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    setLlmProviderSetupInputKey(null)
    setLlmProviderSetupInput("")
    setNearAiWalletInputActive(false)
    setNearAiWalletInput("")
    setLlmProviderForm({
      mode: "edit",
      providerId: provider.id,
      fields: provider.builtin ? ["baseUrl", "model", "apiKey"] : ["name", "adapter", "baseUrl", "model", "apiKey"],
      index: 0,
      input: "",
      values: {},
      defaults,
    })
  }

  async function submitLlmProviderFormStep() {
    const form = llmProviderForm
    if (!form) return
    const field = form.fields[form.index]
    const values = { ...form.values, [field]: form.input.trim() }
    const nextIndex = form.index + 1
    if (nextIndex < form.fields.length) {
      setLlmProviderForm({ ...form, values, index: nextIndex, input: "" })
      return
    }
    await saveLlmProviderForm({ ...form, values })
  }

  async function saveLlmProviderForm(form: LlmProviderFormState) {
    const provider = form.providerId ? llmProviders().find((item) => item.id === form.providerId) ?? null : null
    const value = (field: LlmProviderFormField) => form.values[field] || form.defaults[field] || ""
    const id = form.mode === "create" ? value("id") : provider?.id || value("id")
    const name = value("name") || id
    const adapter = provider?.builtin ? provider.adapter : value("adapter") || "open_ai_completions"
    const baseUrl = value("baseUrl")
    const model = value("model")
    const apiKey = form.values.apiKey?.trim()
    if (!id || !/^[a-z0-9_-]+$/.test(id)) {
      setLlmConfigError("Provider id must use lowercase letters, numbers, underscores, or hyphens.")
      return
    }
    if (!adapter) {
      setLlmConfigError("Provider adapter is required.")
      return
    }
    setLlmProvidersLoading(true)
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    try {
      const snapshot = await client.upsertLlmProvider({
        id,
        name,
        adapter,
        base_url: baseUrl,
        default_model: model || undefined,
        api_key: apiKey || undefined,
        set_active: provider?.active,
        model: provider?.active && model ? model : undefined,
      })
      setLlmConfig(snapshot)
      if (snapshot.active?.model) setSelectedModel(snapshot.active.model)
      setLlmProviderForm(null)
      setSelectedLlmProviderIndex((index) => wrapIndex(index, snapshot.providers?.length ?? 0))
      setLlmProviderActionMessage(form.mode === "create" ? "Provider created." : "Provider saved.")
    } catch (error) {
      setLlmConfigError(errorMessage(error))
    } finally {
      setLlmProvidersLoading(false)
    }
  }

  function llmProviderFormView(): LlmProviderFormView | null {
    const form = llmProviderForm
    if (!form) return null
    const field = form.fields[form.index]
    return {
      title: form.mode === "create" ? "new provider" : "edit provider",
      fieldLabel: llmProviderFormFieldLabel(field),
      fieldIndex: form.index,
      fieldCount: form.fields.length,
      input: form.input,
      currentValue: form.defaults[field] ?? null,
    }
  }

  async function submitSelectedLlmProviderSetup() {
    const provider = selectedLlmProvider()
    if (!provider || llmProviderSetupInputKey !== "api_key") return
    const apiKey = llmProviderSetupInput.trim()
    if (!apiKey) {
      setLlmConfigError("API key is required.")
      return
    }
    setLlmProvidersLoading(true)
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    try {
      const model = provider.active_model || provider.default_model || selectedModel
      const snapshot = await client.upsertLlmProvider({
        id: provider.id,
        name: provider.description || provider.id,
        adapter: provider.adapter,
        base_url: provider.base_url || "",
        default_model: provider.default_model || model,
        api_key: apiKey,
        set_active: provider.active,
        model,
      })
      setLlmConfig(snapshot)
      if (snapshot.active?.model) setSelectedModel(snapshot.active.model)
      setLlmProviderSetupInput("")
      setLlmProviderSetupInputKey(null)
      setLlmProviderActionMessage("Provider credentials saved.")
    } catch (error) {
      setLlmConfigError(errorMessage(error))
    } finally {
      setLlmProvidersLoading(false)
    }
  }

  async function submitNearAiWalletLogin() {
    const value = nearAiWalletInput.trim()
    if (!value) {
      setLlmConfigError("Wallet login JSON is required.")
      return
    }
    let payload: NearAiWalletLoginRequest
    try {
      payload = parseNearAiWalletPayload(value)
    } catch (error) {
      setLlmConfigError(errorMessage(error))
      return
    }
    setLlmProvidersLoading(true)
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    try {
      const result = await client.completeNearAiWalletLogin(payload)
      setNearAiWalletInput("")
      setNearAiWalletInputActive(false)
      await loadLlmConfig()
      setLlmProviderActionMessage(result.active === false ? "Wallet login submitted." : "Wallet login active.")
    } catch (error) {
      setLlmConfigError(errorMessage(error))
    } finally {
      setLlmProvidersLoading(false)
    }
  }

  async function deleteSelectedLlmProvider() {
    const provider = selectedLlmProvider()
    if (!provider) return
    if (provider.builtin) {
      setLlmConfigError("Built-in providers cannot be deleted.")
      return
    }
    setLlmProvidersLoading(true)
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    try {
      const snapshot = await client.deleteLlmProvider(provider.id)
      setLlmConfig(snapshot)
      setSelectedLlmProviderIndex((index) => wrapIndex(index, snapshot.providers?.length ?? 0))
      setLlmProviderActionMessage(`${provider.description || provider.id} deleted.`)
    } catch (error) {
      setLlmConfigError(errorMessage(error))
    } finally {
      setLlmProvidersLoading(false)
    }
  }

  async function startSelectedLlmProviderLogin(authProvider: NearAiAuthProvider = "github") {
    const provider = selectedLlmProvider()
    if (!provider) return
    setLlmProvidersLoading(true)
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    try {
      if (provider.id === "nearai" || provider.adapter === "nearai") {
        const response = await client.startNearAiLogin(authProvider, originForBaseUrl(config.baseUrl))
        if (response.auth_url) await openExternalUrl(response.auth_url)
        setLlmProviderActionMessage(response.auth_url ? `${authProvider} login opened.` : `${authProvider} login started.`)
        return
      }
      if (provider.id === "openai_codex" || provider.adapter === "openai_codex") {
        const response = await client.startCodexLogin()
        const userCode = response.user_code ? ` code ${response.user_code}` : ""
        setLlmProviderActionMessage(response.verification_uri ? `Open: ${response.verification_uri}${userCode}` : `Device login started.${userCode}`)
        return
      }
      setLlmConfigError("This provider has no login route; use API key setup.")
    } catch (error) {
      setLlmConfigError(errorMessage(error))
    } finally {
      setLlmProvidersLoading(false)
    }
  }

  async function testSelectedLlmProvider() {
    const provider = selectedLlmProvider()
    if (!provider) return
    setLlmProvidersLoading(true)
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    try {
      const result = await client.testLlmProvider(provider)
      const ok = result.success ?? result.ok ?? !result.error
      setLlmProviderActionMessage(ok ? (result.message || "Connection test passed.") : (result.error || result.message || "Connection test failed."))
    } catch (error) {
      setLlmConfigError(errorMessage(error))
    } finally {
      setLlmProvidersLoading(false)
    }
  }

  async function listSelectedLlmProviderModels() {
    const provider = selectedLlmProvider()
    if (!provider) return
    setLlmProvidersLoading(true)
    setLlmConfigError(null)
    setLlmProviderActionMessage(null)
    try {
      const result = await client.listLlmProviderModels(provider)
      const models = result.models ?? []
      setLlmProviderModels(models)
      setLlmProviderActionMessage(models.length ? `${models.length} models found.` : (result.error || "No models returned."))
    } catch (error) {
      setLlmProviderModels([])
      setLlmConfigError(errorMessage(error))
    } finally {
      setLlmProvidersLoading(false)
    }
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

  function selectedExtension(): ExtensionRow | null {
    return extensionList[wrapIndex(selectedExtensionIndex, extensionList.length)] ?? null
  }

  async function runSelectedExtensionDefaultAction() {
    const row = selectedExtension()
    if (!row) return
    if (!row.installed) {
      await runExtensionAction(() => client.installExtension(row.entry.package_ref))
      return
    }
    if (row.needsSetup) {
      await loadSelectedExtensionSetup()
      return
    }
    if (!row.active) {
      await runExtensionAction(() => client.activateExtension(row.id))
    }
  }

  async function removeSelectedExtension() {
    const row = selectedExtension()
    if (!row?.installed) return
    await runExtensionAction(() => client.removeExtension(row.id))
  }

  async function loadSelectedExtensionSetup() {
    const row = selectedExtension()
    if (!row) return
    setExtensionsLoading(true)
    setExtensionsError(null)
    setExtensionActionMessage(null)
    try {
      const setup = await client.extensionSetup(row.id)
      setExtensionSetup(setup)
      const inputKey = firstSetupInputKey(setup)
      setExtensionSetupInputKey(inputKey)
      setExtensionSetupInput("")
      if (!inputKey) setExtensionActionMessage("Setup is already complete.")
    } catch (error) {
      setExtensionsError(errorMessage(error))
    } finally {
      setExtensionsLoading(false)
    }
  }

  async function submitSelectedExtensionSetup() {
    const row = selectedExtension()
    if (!row || !extensionSetupInputKey) return
    const value = extensionSetupInput.trim()
    if (!value) {
      setExtensionsError("Setup value is required.")
      return
    }
    const [kind, name] = extensionSetupInputKey.split(":", 2)
    const payload = {
      secrets: kind === "secret" ? { [name]: value } : {},
      fields: kind === "field" ? { [name]: value } : {},
    }
    setExtensionsLoading(true)
    setExtensionsError(null)
    try {
      const setup = await client.submitExtensionSetup(row.id, payload)
      setExtensionSetup(setup)
      setExtensionSetupInput("")
      const inputKey = firstSetupInputKey(setup)
      setExtensionSetupInputKey(inputKey)
      setExtensionActionMessage(inputKey ? "Setup value submitted." : "Setup complete.")
      await loadExtensions()
    } catch (error) {
      setExtensionsError(errorMessage(error))
    } finally {
      setExtensionsLoading(false)
    }
  }

  async function runExtensionAction(action: () => Promise<{ success: boolean; message?: string | null; instructions?: string | null; auth_url?: string | null }>) {
    setExtensionsLoading(true)
    setExtensionsError(null)
    setExtensionActionMessage(null)
    try {
      const response = await action()
      setExtensionActionMessage(response.message || response.instructions || (response.success ? "Extension action complete." : "Extension action failed."))
      if (response.auth_url) await openExternalUrl(response.auth_url)
      await loadExtensions()
    } catch (error) {
      setExtensionsError(errorMessage(error))
    } finally {
      setExtensionsLoading(false)
    }
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
    if (content.startsWith("/attach ")) {
      clearComposer()
      await stageAttachmentFromPath(content.slice("/attach ".length).trim())
      return
    }
    if (content === "/save" || content.startsWith("/save ")) {
      clearComposer()
      await saveAttachment(content.slice("/save".length).trim())
      return
    }
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
    const attachments = stagedAttachments
    applyOutgoingModelCommand(content)
    clearComposer()
    dispatch({ type: "user_sent", content, threadId: state.activeThreadId })
    try {
      const response = await client.send(content, state.activeThreadId, {
        attachments: attachments.length ? attachments.map(toOutgoingAttachment) : undefined,
      })
      const threadId = response.thread_id ?? state.activeThreadId
      if (threadId) activeThreadIdRef.current = threadId
      // A busy thread already has an active run: surface the notice (not an error)
      // and keep the composer intact.
      if (response.outcome === "rejected_busy") {
        dispatch({ type: "notice", message: response.notice ?? "A run is already active on this thread." })
        return
      }
      setStagedAttachments([])
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
        if (config.mode === "local") {
          clearComposer("skills")
          await openSkillsPalette()
        } else {
          clearComposer("skills-remote")
          await openRemoteSkillsOverlay()
        }
        return
      case "logs":
        clearComposer("logs")
        await openLogsOverlay()
        return
      case "traces":
        clearComposer("traces")
        await openTracesOverlay()
        return
      case "workspace":
        clearComposer("workspace")
        await openWorkspaceOverlay()
        return
      case "projects":
        clearComposer()
        await openProjectsOverlay()
        return
      case "tools":
        clearComposer("tools")
        await openToolsOverlay()
        return
      case "outbound":
        clearComposer("outbound")
        await openOutboundOverlay()
        return
      case "inbox":
        clearComposer()
        await jumpToApprovalInbox()
        return
      case "retry":
        clearComposer()
        await retryLastRun()
        return
      case "delete-thread":
        clearComposer()
        await deleteActiveThread()
        return
      case "attach":
        clearComposer()
        dispatch({ type: "notice", message: "usage: /attach <path>" })
        return
      case "save":
        clearComposer()
        await saveAttachment("")
        return
      case "extensions":
        clearComposer("extensions")
        await openExtensionsOverlay()
        return
      case "automations":
        clearComposer("automations")
        await openAutomationsOverlay()
        return
      case "channels":
        clearComposer("channels")
        await openChannelsOverlay()
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
        await openSettingsOverlay()
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

  function copyTextToClipboard(text: string) {
    if (text) renderer.copyToClipboardOSC52(text)
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

  // ---- Attachments ----

  async function stageAttachmentFromPath(rawPath: string) {
    const path = rawPath.replace(/^['"]|['"]$/g, "").trim()
    if (!path) {
      dispatch({ type: "notice", message: "usage: /attach <path>" })
      return
    }
    try {
      const file = Bun.file(path)
      if (!(await file.exists())) {
        dispatch({ type: "error", message: `File not found: ${path}` })
        return
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      const filename = basename(path)
      const candidate = { filename, mime_type: mimeFromExtension(filename), size_bytes: bytes.byteLength }
      const validation = validateStagedAttachment(candidate, stagedAttachments, attachmentBudget(state.session))
      if (!validation.ok) {
        dispatch({ type: "notice", message: validation.error })
        return
      }
      const staged: StagedAttachment = { ...candidate, data_base64: Buffer.from(bytes).toString("base64") }
      setStagedAttachments((current) => [...current, staged])
      dispatch({ type: "notice", message: `staged ${filename}` })
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function saveAttachment(rawIndex: string) {
    const threadId = state.activeThreadId
    if (!threadId) {
      dispatch({ type: "error", message: "No active thread." })
      return
    }
    const parsed = Number.parseInt(rawIndex.trim(), 10)
    const index = Number.isFinite(parsed) && parsed > 0 ? parsed : 1
    try {
      const history = await client.history(threadId)
      const latest = history.message_attachments?.[history.message_attachments.length - 1]
      if (!latest || latest.refs.length === 0) {
        dispatch({ type: "notice", message: "No attachments on the latest message." })
        return
      }
      const ref = latest.refs[index - 1]
      if (!ref) {
        dispatch({ type: "notice", message: `Attachment ${index} not found (have ${latest.refs.length}).` })
        return
      }
      const bytes = await client.attachment(threadId, latest.message_id, ref.attachment_id)
      const filename = ref.filename || bytes.filename || `attachment-${index}`
      await Bun.write(filename, bytes.bytes)
      dispatch({ type: "notice", message: `saved ${filename}` })
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  // ---- Retry / inbox / delete thread ----

  async function retryLastRun() {
    const threadId = state.activeThreadId
    const runId = state.activeRunId ?? lastRetryableRunId(state.transcript)
    if (!threadId || !runId) {
      dispatch({ type: "notice", message: "No failed or cancelled run to retry." })
      return
    }
    try {
      const response = await client.retryRun(threadId, runId)
      dispatch({ type: "run_started", threadId, runId: response.run_id, status: response.status })
      void pollThreadForReply(threadId, state.transcript.filter((item) => item.role === "assistant").length)
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function jumpToApprovalInbox() {
    try {
      const inbox = await client.approvalInbox()
      dispatch({ type: "approval_count", count: inbox.count })
      const next = inbox.threads.find((thread) => thread.thread_id !== state.activeThreadId) ?? inbox.threads[0]
      if (!next) {
        dispatch({ type: "notice", message: "No threads need approval." })
        return
      }
      await loadThread(next.thread_id)
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function deleteActiveThread() {
    const threadId = state.activeThreadId
    if (!threadId) return
    try {
      await client.deleteThread(threadId)
      const remaining = state.threads.filter((thread) => thread.id !== threadId)
      dispatch({ type: "threads", threads: remaining, activeThreadId: remaining[0]?.id ?? null })
      if (remaining[0]) await loadThread(remaining[0].id)
      else await createThread()
      dispatch({ type: "notice", message: "thread deleted" })
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function deleteSelectedThread() {
    const thread = filteredThreadList[wrapIndex(selectedThreadIndex, filteredThreadList.length)]
    if (!thread) return
    try {
      await client.deleteThread(thread.id)
      const remaining = paletteThreads.filter((item) => item.id !== thread.id)
      setPaletteThreads(remaining)
      dispatch({ type: "threads", threads: state.threads.filter((item) => item.id !== thread.id), activeThreadId: state.activeThreadId })
      setSelectedThreadIndex((index) => wrapIndex(index, remaining.length))
      if (thread.id === state.activeThreadId) {
        if (remaining[0]) await loadThread(remaining[0].id)
        else await createThread()
      }
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  // ---- Remote skills ----

  async function openRemoteSkillsOverlay() {
    setActiveOverlay("skills-remote")
    setRemoteSkillDetail(null)
    setSkillInstall(null)
    setRemoteSkillConfirmRemove(false)
    setRemoteSkillMessage(null)
    setRemoteSkillQuery("")
    setRemoteSkillIndex(0)
    await loadRemoteSkills()
  }

  async function loadRemoteSkills() {
    setRemoteSkillsLoading(true)
    setRemoteSkillsError(null)
    try {
      const response = await client.skills()
      setRemoteSkills(response.skills ?? [])
      setAutoActivateLearned(Boolean(response.auto_activate_learned))
    } catch (error) {
      setRemoteSkills([])
      setRemoteSkillsError(errorMessage(error))
    } finally {
      setRemoteSkillsLoading(false)
    }
  }

  async function searchRemoteSkills(query: string) {
    if (!query.trim()) {
      await loadRemoteSkills()
      return
    }
    setRemoteSkillsLoading(true)
    setRemoteSkillsError(null)
    try {
      const response = await client.searchSkills(query.trim())
      setRemoteSkills(response.installed ?? [])
    } catch (error) {
      setRemoteSkillsError(errorMessage(error))
    } finally {
      setRemoteSkillsLoading(false)
    }
  }

  function selectedRemoteSkill(): SkillInfo | null {
    return filteredRemoteSkills[wrapIndex(remoteSkillIndex, filteredRemoteSkills.length)] ?? null
  }

  async function openRemoteSkillDetail() {
    const skill = selectedRemoteSkill()
    if (!skill) return
    setRemoteSkillDetail({ name: skill.name, content: "", loading: true, error: null, offset: 0 })
    try {
      const response = await client.skillContent(skill.name)
      setRemoteSkillDetail({ name: skill.name, content: response.content, loading: false, error: null, offset: 0 })
    } catch (error) {
      setRemoteSkillDetail({ name: skill.name, content: "", loading: false, error: errorMessage(error), offset: 0 })
    }
  }

  async function submitSkillInstallStep() {
    const install = skillInstall
    if (!install) return
    if (install.step === "name") {
      const name = install.name.trim()
      if (!name) {
        setRemoteSkillMessage("Skill name is required.")
        return
      }
      setSkillInstall({ ...install, step: "content" })
      return
    }
    setRemoteSkillsLoading(true)
    setRemoteSkillMessage(null)
    try {
      const response = await client.installSkill(install.name.trim(), install.content.trim() || null)
      setSkillInstall(null)
      setRemoteSkillMessage(response.message || "Skill installed.")
      await loadRemoteSkills()
    } catch (error) {
      setRemoteSkillMessage(errorMessage(error))
    } finally {
      setRemoteSkillsLoading(false)
    }
  }

  async function removeSelectedRemoteSkill() {
    const skill = selectedRemoteSkill()
    if (!skill) return
    setRemoteSkillsLoading(true)
    try {
      const response = await client.removeSkill(skill.name)
      setRemoteSkillMessage(response.message || "Skill removed.")
      setRemoteSkillConfirmRemove(false)
      await loadRemoteSkills()
    } catch (error) {
      setRemoteSkillMessage(errorMessage(error))
    } finally {
      setRemoteSkillsLoading(false)
    }
  }

  async function toggleSelectedSkillAutoActivate() {
    const skill = selectedRemoteSkill()
    if (!skill) return
    try {
      await client.setSkillAutoActivate(skill.name, !skill.auto_activate)
      await loadRemoteSkills()
    } catch (error) {
      setRemoteSkillMessage(errorMessage(error))
    }
  }

  async function toggleLearnedAutoActivate() {
    try {
      const response = await client.setAutoActivateLearned(!autoActivateLearned)
      setAutoActivateLearned(!autoActivateLearned)
      setRemoteSkillMessage(response.message || `Learned auto-activate ${!autoActivateLearned ? "on" : "off"}.`)
    } catch (error) {
      setRemoteSkillMessage(errorMessage(error))
    }
  }

  // ---- Logs ----

  async function openLogsOverlay() {
    setActiveOverlay("logs")
    setLogEditingTarget(false)
    setLogTargetInput("")
    await loadLogs(logFilter, true)
  }

  async function loadLogs(filter: LogFilterState, reset: boolean) {
    setLogsLoading(true)
    setLogsError(null)
    try {
      const response = await client.logs(buildLogQuery({ ...filter, cursor: reset ? undefined : filter.cursor }))
      setLogEntries(reset ? response.entries : (current) => [...response.entries, ...current])
      setLogSource(response.source)
      setLogTailSupported(response.tail_supported)
      setLogFollowSupported(response.follow_supported)
      setLogCursor(response.next_cursor ?? null)
    } catch (error) {
      setLogsError(errorMessage(error))
    } finally {
      setLogsLoading(false)
    }
  }

  async function loadOlderLogs() {
    if (!logCursor) return
    await loadLogs({ ...logFilter, cursor: logCursor }, false)
  }

  // ---- Traces ----

  async function openTracesOverlay() {
    setActiveOverlay("traces")
    setTraceMessage(null)
    setSelectedHoldIndex(0)
    await loadTraces()
  }

  async function loadTraces() {
    setTracesLoading(true)
    setTracesError(null)
    try {
      const [credits, account] = await Promise.all([
        client.traceCredits().catch(() => null),
        client.traceAccount().catch(() => null),
      ])
      setTraceCredits(credits)
      setTraceAccount(account)
    } catch (error) {
      setTracesError(errorMessage(error))
    } finally {
      setTracesLoading(false)
    }
  }

  async function authorizeSelectedHold() {
    const holds = traceCredits?.holds ?? []
    const hold = holds[wrapIndex(selectedHoldIndex, holds.length)]
    if (!hold) return
    try {
      const response = await client.authorizeTraceHold(hold.submission_id)
      setTraceMessage(response.authorized ? "Hold authorized." : "Authorization not applied.")
      await loadTraces()
    } catch (error) {
      setTracesError(errorMessage(error))
    }
  }

  async function fetchAccountLoginLink() {
    try {
      const response = await client.traceAccountLoginLink()
      setTraceLoginLink(response.url ?? null)
      setTraceMessage(response.url ? "Account login link ready." : "No login link available.")
    } catch (error) {
      setTracesError(errorMessage(error))
    }
  }

  // ---- Workspace (filesystem) ----

  async function openWorkspaceOverlay() {
    setActiveOverlay("workspace")
    setWorkspaceView({ kind: "mounts" })
    setFsSelectedIndex(0)
    setFsFileContent(null)
    setFsStat(null)
    await loadFsMounts()
  }

  async function loadFsMounts() {
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      const response = await client.fsMounts()
      setFsMounts(response.mounts ?? [])
    } catch (error) {
      setWorkspaceError(errorMessage(error))
    } finally {
      setWorkspaceLoading(false)
    }
  }

  async function browseFs(mount: string, path: string) {
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      const response = await client.fsList(mount, path || undefined)
      setFsEntries(response.entries ?? [])
      setWorkspaceView({ kind: "browse", mount, path: response.path ?? path })
      setFsSelectedIndex(0)
    } catch (error) {
      setWorkspaceError(errorMessage(error))
    } finally {
      setWorkspaceLoading(false)
    }
  }

  async function openFsEntry() {
    if (workspaceView.kind !== "browse") return
    const entry = fsEntries[wrapIndex(fsSelectedIndex, fsEntries.length)]
    if (!entry) return
    if (entry.kind === "directory") {
      await browseFs(workspaceView.mount, entry.path)
      return
    }
    setWorkspaceView({ kind: "file", mount: workspaceView.mount, path: entry.path })
    setFsFileContent(null)
    setFsFileOffset(0)
    setWorkspaceLoading(true)
    try {
      const [stat, content] = await Promise.all([
        client.fsStat(workspaceView.mount, entry.path).then((response) => response.stat).catch(() => null),
        client.fsContent(workspaceView.mount, entry.path),
      ])
      setFsStat(stat)
      setFsFileContent(new TextDecoder().decode(content.bytes))
    } catch (error) {
      setWorkspaceError(errorMessage(error))
      setFsFileContent("")
    } finally {
      setWorkspaceLoading(false)
    }
  }

  async function fsGoUp() {
    if (workspaceView.kind === "file") {
      setWorkspaceView({ kind: "browse", mount: workspaceView.mount, path: parentPath(workspaceView.path) })
      await browseFs(workspaceView.mount, parentPath(workspaceView.path))
      return
    }
    if (workspaceView.kind === "browse") {
      if (!workspaceView.path) {
        setWorkspaceView({ kind: "mounts" })
        return
      }
      await browseFs(workspaceView.mount, parentPath(workspaceView.path))
    }
  }

  // ---- Projects ----

  async function openProjectsOverlay() {
    if (!projectsEnabled) {
      dispatch({ type: "notice", message: "Projects are not enabled (reborn_projects feature off)." })
      return
    }
    setActiveOverlay("projects")
    setProjectsView("list")
    setProjectConfirmDelete(false)
    setProjectMessage(null)
    setSelectedProjectIndex(0)
    await loadProjects()
  }

  async function loadProjects() {
    setProjectsLoading(true)
    setProjectsError(null)
    try {
      const response = await client.projects()
      setProjects(response.projects ?? [])
    } catch (error) {
      setProjectsError(errorMessage(error))
    } finally {
      setProjectsLoading(false)
    }
  }

  async function createProjectFromInput() {
    const name = projectCreateInput.trim()
    if (!name) {
      setProjectMessage("Project name is required.")
      return
    }
    setProjectsLoading(true)
    try {
      await client.createProject({ name })
      setProjectCreateInput("")
      setProjectsView("list")
      setProjectMessage("Project created.")
      await loadProjects()
    } catch (error) {
      setProjectMessage(errorMessage(error))
    } finally {
      setProjectsLoading(false)
    }
  }

  async function openProjectMembersView() {
    const project = projects[wrapIndex(selectedProjectIndex, projects.length)]
    if (!project) return
    setProjectsView("members")
    setProjectsLoading(true)
    try {
      const response = await client.projectMembers(project.project_id)
      setProjectMembers(response.members ?? [])
    } catch (error) {
      setProjectsError(errorMessage(error))
    } finally {
      setProjectsLoading(false)
    }
  }

  async function deleteSelectedProject() {
    const project = projects[wrapIndex(selectedProjectIndex, projects.length)]
    if (!project) return
    try {
      await client.deleteProject(project.project_id)
      setProjectConfirmDelete(false)
      setProjectMessage("Project deleted.")
      await loadProjects()
    } catch (error) {
      setProjectsError(errorMessage(error))
    }
  }

  // ---- Tools (settings/tools) ----

  async function openToolsOverlay() {
    setActiveOverlay("tools")
    setToolsMessage(null)
    setSelectedToolIndex(0)
    await loadTools()
  }

  async function loadTools() {
    setToolsLoading(true)
    setToolsError(null)
    try {
      const response = await client.settingsTools()
      setToolRows(toolPermissionRows(response.entries ?? []))
      setToolsGlobalAutoApprove(Boolean(state.session?.features.global_auto_approve))
    } catch (error) {
      setToolsError(errorMessage(error))
    } finally {
      setToolsLoading(false)
    }
  }

  async function cycleSelectedToolPermission() {
    const row = toolRows[wrapIndex(selectedToolIndex, toolRows.length)]
    if (!row || !row.mutable) return
    const next = nextToolPermission(row.permission)
    setToolRows((rows) => rows.map((item) => (item.capabilityId === row.capabilityId ? { ...item, permission: next } : item)))
    try {
      await client.setSettingsToolPermission(row.capabilityId, next)
      setToolsMessage(`${row.label} → ${next}`)
    } catch (error) {
      setToolsError(errorMessage(error))
      await loadTools()
    }
  }

  async function toggleGlobalAutoApprove() {
    const next = !toolsGlobalAutoApprove
    setToolsGlobalAutoApprove(next)
    try {
      await client.setSettingsToolsAutoApprove(next)
      setToolsMessage(`global auto-approve ${next ? "on" : "off"}`)
    } catch (error) {
      setToolsGlobalAutoApprove(!next)
      setToolsError(errorMessage(error))
    }
  }

  // ---- Outbound ----

  async function openOutboundOverlay() {
    setActiveOverlay("outbound")
    setOutboundMessage(null)
    setSelectedOutboundIndex(0)
    await loadOutbound()
  }

  async function loadOutbound() {
    setOutboundLoading(true)
    setOutboundError(null)
    try {
      const [prefs, targets] = await Promise.all([client.outboundPreferences(), client.outboundTargets()])
      setOutboundPrefs(prefs)
      setOutboundTargets(targets.targets ?? [])
    } catch (error) {
      setOutboundError(errorMessage(error))
    } finally {
      setOutboundLoading(false)
    }
  }

  async function setSelectedOutboundTarget() {
    const option = outboundTargets[wrapIndex(selectedOutboundIndex, outboundTargets.length)]
    if (!option) return
    try {
      const prefs = await client.setOutboundPreferences(option.target.target_id)
      setOutboundPrefs(prefs)
      setOutboundMessage(`final reply → ${option.target.display_name}`)
    } catch (error) {
      setOutboundError(errorMessage(error))
    }
  }

  async function clearOutboundTarget() {
    try {
      const prefs = await client.setOutboundPreferences(null)
      setOutboundPrefs(prefs)
      setOutboundMessage("final-reply target cleared")
    } catch (error) {
      setOutboundError(errorMessage(error))
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

  async function resolveGate(action: GateAction | "cancelled") {
    if (!state.pendingGate) return
    const base = {
      request_id: state.pendingGate.request_id,
      thread_id: state.pendingGate.thread_id,
      run_id: state.pendingGate.run_id,
      gate_ref: state.pendingGate.gate_ref,
    }
    try {
      if (action === "always") {
        await client.resolveGate({ ...base, resolution: "approved", always: true })
      } else if (action === "approved") {
        await client.resolveGate({ ...base, resolution: "approved" })
      } else if (action === "denied") {
        await client.resolveGate({ ...base, resolution: "denied" })
      } else {
        await client.resolveGate({ ...base, resolution: "cancelled" })
      }
      dispatch({ type: "gate_cleared" })
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function submitAuthToken() {
    const gate = state.pendingGate
    if (!gate || !isAuthGate(gate) || !isManualTokenGate(gate) || authTokenSubmitting) return
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

  async function openAuthUrl(gate: PendingGateInfo) {
    setAuthTokenError(null)
    try {
      await openExternalUrl(gate.authorization_url)
    } catch (error) {
      setAuthTokenError(errorMessage(error))
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
    approvalCount: state.approvalCount,
    usageCost: state.runUsageCost,
    notice: state.notice,
    stagedAttachments,
    threadDeleteConfirm,
    onInputChange: handleInputChange,
    onSubmit: submit,
  }

  return (
    <box style={{ width, height, flexDirection: "column", backgroundColor: theme.bg }}>
      {showAutomations ? (
        <AutomationsSurface
          automations={automations}
          error={automationsError}
          height={height}
          loading={automationsLoading}
          selectedIndex={wrapIndex(selectedAutomationIndex, automations.length)}
          renaming={automationRenameActive}
          renameInput={automationRenameInput}
          confirmingDelete={automationConfirmDelete}
          message={automationMessage}
          width={width}
        />
      ) : showChannels ? (
        <ChannelsSurface
          channels={channels}
          error={channelsError}
          height={height}
          loading={channelsLoading}
          selectedIndex={wrapIndex(selectedChannelIndex, channels.length)}
          width={width}
        />
      ) : showExtensions ? (
        <ExtensionsSurface
          actionMessage={extensionActionMessage}
          error={extensionsError}
          height={height}
          loading={extensionsLoading}
          rows={extensionList}
          selectedIndex={wrapIndex(selectedExtensionIndex, extensionList.length)}
          setup={extensionSetup}
          setupInput={extensionSetupInput}
          setupInputLabel={extensionSetupInputLabel(extensionSetup, extensionSetupInputKey)}
          width={width}
        />
      ) : showSkills ? (
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
      ) : showLlmProviders ? (
        <LlmProvidersSurface
          actionMessage={llmProviderActionMessage}
          availableModels={llmProviderModels}
          error={llmConfigError}
          form={llmProviderFormView()}
          height={height}
          loading={llmProvidersLoading}
          nearAiWalletInput={nearAiWalletInput}
          nearAiWalletInputActive={nearAiWalletInputActive}
          selectedIndex={wrapIndex(selectedLlmProviderIndex, llmProviders().length)}
          setupInput={llmProviderSetupInput}
          setupInputLabel={llmProviderSetupInputKey ? "API key" : null}
          snapshot={llmConfig}
          width={width}
        />
      ) : showSettings ? (
        <SettingsSurface
          config={config}
          connected={state.connected}
          automationCount={automations.length}
          channelCount={channels.length}
          extensionCount={extensions.length}
          extensionSetupCount={extensions.filter((extension) => extension.needs_setup).length}
          height={height}
          llmConfig={llmConfig}
          llmConfigError={llmConfigError}
          session={state.session}
          operatorOnly={operatorOnly}
          selectedIndex={selectedSettingsIndex}
          selectedModel={selectedModel}
          selectedProvider={providerLabel(config.provider)}
          skillCount={config.mode === "local" ? skillList.configured : remoteSkills.length}
          skillsRemote={config.mode !== "local"}
          status={state.status}
          width={width}
        />
      ) : showRemoteSkills ? (
        <SkillsRemoteSurface
          skills={filteredRemoteSkills}
          query={remoteSkillQuery}
          autoActivateLearned={autoActivateLearned}
          selectedIndex={wrapIndex(remoteSkillIndex, filteredRemoteSkills.length)}
          detail={remoteSkillDetail}
          install={skillInstall}
          confirmingRemove={remoteSkillConfirmRemove}
          message={remoteSkillMessage}
          loading={remoteSkillsLoading}
          error={remoteSkillsError}
          markdownStyle={markdownStyle}
          width={width}
          height={height}
        />
      ) : showLogs ? (
        <LogsSurface
          entries={logEntries}
          filter={logFilter}
          editingTarget={logEditingTarget}
          targetInput={logTargetInput}
          source={logSource}
          tailSupported={logTailSupported}
          followSupported={logFollowSupported}
          hasOlder={Boolean(logCursor)}
          loading={logsLoading}
          error={logsError}
          width={width}
          height={height}
        />
      ) : showTraces ? (
        <TracesSurface
          credits={traceCredits}
          account={traceAccount}
          loginLink={traceLoginLink}
          selectedHoldIndex={wrapIndex(selectedHoldIndex, traceCredits?.holds.length ?? 0)}
          message={traceMessage}
          loading={tracesLoading}
          error={tracesError}
          width={width}
          height={height}
        />
      ) : showWorkspace ? (
        <WorkspaceSurface
          view={workspaceView}
          mounts={fsMounts}
          entries={fsEntries}
          stat={fsStat}
          fileContent={fsFileContent}
          fileOffset={fsFileOffset}
          selectedIndex={fsSelectedIndex}
          loading={workspaceLoading}
          error={workspaceError}
          width={width}
          height={height}
        />
      ) : showProjects ? (
        <ProjectsSurface
          view={projectsView}
          projects={projects}
          members={projectMembers}
          selectedIndex={selectedProjectIndex}
          createInput={projectCreateInput}
          confirmingDelete={projectConfirmDelete}
          message={projectMessage}
          loading={projectsLoading}
          error={projectsError}
          width={width}
          height={height}
        />
      ) : showTools ? (
        <ToolsSurface
          rows={toolRows}
          globalAutoApprove={toolsGlobalAutoApprove}
          session={state.session ?? null}
          selectedIndex={wrapIndex(selectedToolIndex, toolRows.length)}
          message={toolsMessage}
          loading={toolsLoading}
          error={toolsError}
          width={width}
          height={height}
        />
      ) : showOutbound ? (
        <OutboundSurface
          preferences={outboundPrefs}
          targets={outboundTargets}
          selectedIndex={wrapIndex(selectedOutboundIndex, outboundTargets.length)}
          message={outboundMessage}
          loading={outboundLoading}
          error={outboundError}
          width={width}
          height={height}
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
          onOpenAuthUrl={(gate) => void openAuthUrl(gate)}
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

function firstSetupInputKey(setup: ExtensionSetupResponse): string | null {
  const secret = (setup.secrets ?? []).find((item) => !item.provided && !item.optional)
  if (secret) return `secret:${secret.name}`
  const field = (setup.fields ?? []).find((item) => item.required && !item.value)
  if (field) return `field:${field.name}`
  return null
}

function extensionSetupInputLabel(setup: ExtensionSetupResponse | null, key: string | null): string | null {
  if (!setup || !key) return null
  const [kind, name] = key.split(":", 2)
  if (kind === "secret") {
    const secret = (setup.secrets ?? []).find((item) => item.name === name)
    return secret ? `${secret.provider}: ${secret.prompt}` : name
  }
  const field = (setup.fields ?? []).find((item) => item.name === name)
  return field?.prompt || field?.label || name
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

function originForBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin
  } catch {
    return baseUrl
  }
}

function parseNearAiWalletPayload(value: string): NearAiWalletLoginRequest {
  const parsed = JSON.parse(value) as Partial<NearAiWalletLoginRequest>
  if (!parsed || typeof parsed !== "object") throw new Error("Wallet login payload must be a JSON object.")
  const required = ["account_id", "public_key", "signature", "message", "recipient"] as const
  for (const field of required) {
    if (typeof parsed[field] !== "string" || !parsed[field]?.trim()) {
      throw new Error(`Wallet login payload is missing ${field}.`)
    }
  }
  if (!Array.isArray(parsed.nonce) || !parsed.nonce.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new Error("Wallet login nonce must be an array of byte values.")
  }
  const accountId = parsed.account_id
  const publicKey = parsed.public_key
  const signature = parsed.signature
  const message = parsed.message
  const recipient = parsed.recipient
  if (!accountId || !publicKey || !signature || !message || !recipient) {
    throw new Error("Wallet login payload is missing required fields.")
  }
  return {
    account_id: accountId,
    public_key: publicKey,
    signature,
    message,
    recipient,
    nonce: parsed.nonce,
    callback_url: typeof parsed.callback_url === "string" ? parsed.callback_url : undefined,
  }
}

function llmProviderFormFieldLabel(field: LlmProviderFormField): string {
  switch (field) {
    case "apiKey":
      return "api key"
    case "baseUrl":
      return "base URL"
    default:
      return field
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

function filterRemoteSkills(skills: SkillInfo[], query: string): SkillInfo[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return skills
  return skills.filter((skill) =>
    `${skill.name} ${skill.description} ${skill.keywords.join(" ")}`.toLowerCase().includes(trimmed),
  )
}

// Extract the most recent failed/cancelled run id from failure/cancelled system
// transcript items (their ids are `run-<id>-<status>`).
function lastRetryableRunId(transcript: Array<{ id: string; role: string }>): string | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index]
    if (!item) continue
    const match = item.id.match(/^run-(.+)-(failed|cancelled|killed|recovery_required)$/)
    if (match?.[1]) return match[1]
  }
  return null
}

function parentPath(path: string): string {
  const normalized = path.replace(/\/+$/, "")
  const index = normalized.lastIndexOf("/")
  return index > 0 ? normalized.slice(0, index) : ""
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

function hasCommandModifier(key: Pick<KeyEvent, "meta" | "super">): boolean {
  return key.meta || Boolean(key.super)
}

function isCommandCopy(key: KeyEvent): boolean {
  return hasCommandModifier(key) && key.name.toLowerCase() === "c"
}

function isCommandSpace(key: KeyEvent): boolean {
  return hasCommandModifier(key) && (key.name === "space" || key.sequence === " ")
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

function authChallengeKind(gate: PendingGateInfo): string {
  return gate.challenge_kind || "manual_token"
}

function isManualTokenGate(gate: PendingGateInfo): boolean {
  return authChallengeKind(gate) === "manual_token"
}

function isOauthGate(gate: PendingGateInfo): boolean {
  return authChallengeKind(gate) === "oauth_url"
}

function hasAuthorizationUrl(gate: PendingGateInfo): boolean {
  return Boolean(gate.authorization_url)
}

async function openExternalUrl(rawUrl?: string | null): Promise<void> {
  if (!rawUrl) throw new Error("Authorization URL is missing.")
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error("Authorization URL is invalid.")
  }
  if (url.protocol !== "https:") throw new Error("Authorization URL must use HTTPS.")

  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url.toString()] : [url.toString()]
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
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
  const railColors = accentRamp

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
