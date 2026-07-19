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
  AutomationMutationResponse,
  ConnectableChannelInfo,
  ExtensionInfo,
  ExtensionRegistryEntry,
  ExtensionSetupResponse,
  FsMountInfo,
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
import { initialUiState, isTerminalRunState, reduceUiState, type ActivityItem } from "../state"
import { filterThreads, sortThreadsByRecent, threadDisplayTitle, threadPreviewFromHistory, type ThreadPreviewMap } from "../threadPreviews"
import { loadUiPrefs, saveNotifyLevel } from "../uiPrefs"
import { AutomationsSurface } from "./AutomationsSurface"
import { ChannelsSurface } from "./ChannelsSurface"
import { ExtensionsSurface, extensionRows, type ExtensionRow } from "./ExtensionsSurface"
import { LlmProvidersSurface, type LlmProviderFormView } from "./LlmProvidersSurface"
import { ConversationSurface, ThreadsSidebar, WelcomeSurface, type ComposerCommonProps, type GateAction } from "./MainSurfaces"
import { computeSidebarLayout } from "./threadsSidebar"
import { groupTranscriptEntries } from "./activityGroups"
import { copyTextForItem, moveSelection, searchTranscript, selectableTranscriptIds } from "./transcriptNav"
import { transcriptActivityLines } from "../transcript"
import { HomeSurface, type HomeSection } from "./HomeSurface"
import {
  buildActiveRows,
  buildAutomationsSummary,
  buildNeedsYou,
  buildVitals,
  formatUsd,
  resolveHomeTarget,
  type HomeInputs,
} from "./homeData"
import {
  clearTitle,
  makeNotifyGate,
  notify,
  notifyDedupKey,
  pendingApprovalTitleCount,
  setPendingTitle,
  shouldNotify,
  type NotifyEvent,
  type NotifyKind,
  type NotifyLevel,
} from "./notify"
import { SettingsSurface, SETTINGS_SECTION_COUNT, settingsSectionAt } from "./SettingsSurface"
import { SkillsSurface, type SkillDetailView } from "./SkillsSurface"
import { SkillsRemoteSurface, type RemoteSkillDetail, type SkillInstallState } from "./SkillsRemoteSurface"
import { LogsSurface, LOG_VISIBLE_LIMIT } from "./LogsSurface"
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
import { globalAutoApproveFromEntries, nextToolPermission, toolPermissionRows, type ToolPermissionRow } from "./toolPermissions"
import {
  filteredSlashCommands,
  isSlashCommandInput,
  localCliCommandForInput,
  matchSlashCommand,
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
const HOME_RECENT_LIMIT = 6

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
  // --- Persistent threads sidebar (conversation view) ---
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarFocused, setSidebarFocused] = useState(false)
  const [sidebarIndex, setSidebarIndex] = useState(0)
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
  // --- Transcript navigation + in-thread search (opencode-style) ---
  // navSelectedId is the id of the highlighted transcript message; non-null means
  // the conversation is in transcript-navigation focus mode. Search reuses the
  // same highlight: the active match becomes the selection.
  const [navSelectedId, setNavSelectedId] = useState<string | null>(null)
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
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
  // --- Home (control room) surface ---
  const [showHome, setShowHome] = useState(false)
  const [selectedHomeIndex, setSelectedHomeIndex] = useState(0)
  const [homeCreditsUsd, setHomeCreditsUsd] = useState<number | null>(null)
  // Refs mirror render state so the SSE consumer / poll effects read fresh
  // values without re-subscribing. threadsRef/threadPreviewsRef feed notification
  // titles; the visibility refs gate notification suppression + title updates.
  const threadsRef = useRef<ThreadInfo[]>([])
  const threadPreviewsRef = useRef<ThreadPreviewMap>({})
  const notifyLevelRef = useRef<NotifyLevel>(state.notifyLevel)
  const conversationVisibleRef = useRef(false)
  const activeOverlayRef = useRef<ActiveOverlay>(null)
  const notifyGateRef = useRef(makeNotifyGate())
  // -1 is a sentinel meaning "no baseline yet for this connection": the first
  // poll after (re)connect seeds the baseline instead of paging the whole
  // pre-existing approval backlog.
  const prevApprovalCountRef = useRef(-1)
  // Thread ids currently in the approval inbox. Drives new-approval detection
  // (page only genuinely-new background threads) and the title count (so the
  // active thread's own live gate is not double-counted).
  const approvalThreadIdsRef = useRef<ReadonlySet<string>>(new Set())
  const titleCountRef = useRef<number>(-1)
  const automationsSigRef = useRef<string>("")
  const homeCreditsSigRef = useRef<string>("")
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
  // Scroll offset (entries above the newest window). Lets fetched older entries
  // be reached; 0 pins the view to the newest entries.
  const [logOffset, setLogOffset] = useState(0)
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
  // A conversation is on screen (ConversationSurface + its sidebar) only with a
  // transcript or a live gate; otherwise the WelcomeSurface (empty composer) shows
  // and the sidebar is NOT rendered — so sidebar focus/keys must be gated on this.
  const hasConversation = state.transcript.length > 0 || Boolean(state.pendingGate)

  // --- Threads sidebar layout (persistent, collapsible, responsive) ---
  // Reuses state.threads (the same list the ctrl+t palette shows) — no new fetch.
  const sidebarThreads = useMemo(() => sortThreadsByRecent(state.threads), [state.threads])
  const sidebarLayout = computeSidebarLayout(width, sidebarCollapsed)
  // The sidebar is only truly on screen when a conversation is showing; in the
  // welcome/empty-thread state it isn't rendered even if the layout leaves room.
  const sidebarVisible = sidebarLayout.visible && hasConversation
  const sidebarActive = sidebarVisible && sidebarFocused
  const chatContentWidth = Math.max(1, sidebarLayout.chatWidth - 4)
  // Threads currently awaiting approval — drives the sidebar's warn status dot.
  const approvalThreadIds = useMemo(() => {
    const ids = new Set<string>()
    if (state.pendingGate?.thread_id) ids.add(state.pendingGate.thread_id)
    return ids
  }, [state.pendingGate?.thread_id])

  // --- Home (control room) view-model, assembled from UiState + fetched lists ---
  const homeRecentThreads = useMemo(() => sortThreadsByRecent(state.threads).slice(0, HOME_RECENT_LIMIT), [state.threads])
  const homeHeldAutomations = useMemo(
    () =>
      automations
        .filter((automation) => automation.last_status === "error")
        .map((automation) => ({
          automationId: automation.automation_id,
          name: automation.name,
          detail: "last run errored",
          sinceMs: automation.last_run_at ? Date.parse(automation.last_run_at) : null,
        })),
    [automations],
  )
  const homeInputs: HomeInputs = {
    connected: state.connected,
    model: selectedModel,
    credits: formatUsd(homeCreditsUsd),
    todayCost: state.todayCostUsd > 0 ? formatUsd(state.todayCostUsd) : null,
    pendingApprovals: state.approvalCount,
    gates: state.pendingGate
      ? [
          {
            threadId: state.pendingGate.thread_id,
            threadTitle: threadTitleFor(state.pendingGate.thread_id),
            challengeKind:
              state.pendingGate.gate_name === "auth"
                ? state.pendingGate.challenge_kind || "auth"
                : state.pendingGate.challenge_kind ?? null,
            detail: state.pendingGate.description || state.pendingGate.tool_name,
            sinceMs: state.pendingGateSinceMs ?? null,
          },
        ]
      : [],
    failedRuns: state.lastFailedRun
      ? [
          {
            threadId: state.lastFailedRun.threadId ?? "",
            threadTitle: threadTitleFor(state.lastFailedRun.threadId),
            detail: state.lastFailedRun.detail,
            sinceMs: state.lastFailedRun.sinceMs,
          },
        ]
      : [],
    activeRuns:
      state.isThinking && state.activeThreadId
        ? [
            {
              threadId: state.activeThreadId,
              threadTitle: threadTitleFor(state.activeThreadId),
              status: state.status,
              startedAtMs: state.activeRunSinceMs ?? null,
            },
          ]
        : [],
    heldAutomations: homeHeldAutomations,
  }
  const homeNeedsYou = buildNeedsYou(homeInputs, nowMs)
  const homeActive = buildActiveRows(homeInputs, nowMs)
  const homeSelectableTotal = homeNeedsYou.length + homeActive.length + homeRecentThreads.length
  const homeIndex = homeSelectableTotal > 0 ? wrapIndex(selectedHomeIndex, homeSelectableTotal) : -1
  const homeSchedulerEnabled = automations.some(
    (automation) => automation.is_active || automation.state === "active" || automation.state === "scheduled",
  )

  const toggleActivityExpanded = (id: string) => {
    setExpandedActivityIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // --- Transcript navigation / search derived state ---
  const transcriptEntries = useMemo(() => groupTranscriptEntries(state.transcript), [state.transcript])
  // Activity groups the user has collapsed: their inner activities are unmounted,
  // so selection/search represent them by the group id (a rendered anchor) rather
  // than a hidden child. A group is collapsed when its id is in expandedActivityIds
  // (which tracks the *toggled* state; groups render expanded by default).
  const collapsedGroupIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of transcriptEntries) {
      if (entry.kind === "activity_group" && expandedActivityIds.has(entry.id)) ids.add(entry.id)
    }
    return ids
  }, [transcriptEntries, expandedActivityIds])
  // Ordered ids the nav cursor can land on (rendered anchors only).
  const selectableTranscriptIdList = useMemo(
    () => selectableTranscriptIds(transcriptEntries, collapsedGroupIds),
    [transcriptEntries, collapsedGroupIds],
  )
  const searchMatchIdList = useMemo(
    () => (searchActive ? searchTranscript(transcriptEntries, searchQuery, collapsedGroupIds) : []),
    [searchActive, searchQuery, transcriptEntries, collapsedGroupIds],
  )
  const searchMatchIdSet = useMemo(() => new Set(searchMatchIdList), [searchMatchIdList])
  const navMode = !showHome && activeOverlay === null && !sidebarActive && (navSelectedId !== null || searchActive)
  const inConversationView = !showHome && activeOverlay === null

  // Keep the search cursor pointed at a real match, and mirror it into the shared
  // highlight/selection so the matched message scrolls into view. Clamp the active
  // index when the match list shrinks mid-stream (the transcript can grow/trim
  // without a keystroke) so the counter, highlight, and next-jump target agree.
  useEffect(() => {
    if (!searchActive) return
    const count = searchMatchIdList.length
    const clamped = count === 0 ? 0 : Math.min(searchMatchIndex, count - 1)
    if (clamped !== searchMatchIndex) setSearchMatchIndex(clamped)
    setNavSelectedId(searchMatchIdList[clamped] ?? null)
  }, [searchActive, searchMatchIdList, searchMatchIndex])

  // Drop a stale selection (e.g. after switching threads or trimming history).
  useEffect(() => {
    if (navSelectedId && !selectableTranscriptIdList.includes(navSelectedId)) setNavSelectedId(null)
  }, [selectableTranscriptIdList, navSelectedId])

  // Leaving the conversation surface (overlay / home / sidebar) exits nav + search.
  useEffect(() => {
    if (showHome || activeOverlay !== null || sidebarActive) {
      setNavSelectedId(null)
      setSearchActive(false)
    }
  }, [showHome, activeOverlay, sidebarActive])

  // A thread switch clears any transcript selection / open search.
  useEffect(() => {
    setNavSelectedId(null)
    setSearchActive(false)
    setSearchQuery("")
    setSearchMatchIndex(0)
  }, [state.activeThreadId])

  // A pending gate owns keyboard input: drop any transcript nav / open search the
  // moment a gate arrives so the gate's approve/deny/enter/token keys can't be
  // swallowed by nav- or search-mode key handling.
  useEffect(() => {
    if (state.pendingGate) {
      setNavSelectedId(null)
      setSearchActive(false)
    }
  }, [state.pendingGate?.request_id])

  function enterTranscriptNav() {
    if (selectableTranscriptIdList.length === 0) return
    const last = selectableTranscriptIdList[selectableTranscriptIdList.length - 1] ?? null
    setNavSelectedId(last)
  }

  function exitTranscriptNav() {
    setNavSelectedId(null)
    setSearchActive(false)
  }

  function moveTranscriptSelection(delta: number) {
    setNavSelectedId((current) => moveSelection(selectableTranscriptIdList, current, delta))
  }

  function jumpTranscriptSelection(edge: "top" | "bottom") {
    if (selectableTranscriptIdList.length === 0) return
    const id = edge === "top"
      ? selectableTranscriptIdList[0]
      : selectableTranscriptIdList[selectableTranscriptIdList.length - 1]
    setNavSelectedId(id ?? null)
  }

  function selectedTranscriptItem() {
    return state.transcript.find((item) => item.id === navSelectedId) ?? null
  }

  // `y` — copy the selected message (message text, or an activity card's rendered
  // command + output) to the clipboard via OSC 52.
  function copySelectedTranscriptItem() {
    const item = selectedTranscriptItem()
    if (!item) return
    const detailLines = item.role === "activity" ? transcriptActivityLines(item.activity) : undefined
    const text = copyTextForItem(item, detailLines)
    if (!text) return
    copyTextToClipboard(text)
    dispatch({ type: "notice", message: "copied to clipboard" })
  }

  // `e` — edit & resend: repopulate the composer with a user message and hand
  // focus back to it. Sending is a normal new turn; the original stays put.
  function editSelectedTranscriptItem() {
    const item = selectedTranscriptItem()
    if (!item || item.role !== "user") return
    exitTranscriptNav()
    setComposerText(item.text)
    textareaRef.current?.focus()
  }

  // `enter` — expand/collapse a tool/activity card (no-op on text messages). When
  // the selection is a collapsed activity group (represented by its group id, not
  // a hidden child), enter expands the group.
  function activateSelectedTranscriptItem() {
    if (navSelectedId && collapsedGroupIds.has(navSelectedId)) {
      toggleActivityExpanded(navSelectedId)
      return
    }
    const item = selectedTranscriptItem()
    if (item?.role === "activity") toggleActivityExpanded(item.id)
  }

  function openTranscriptSearch() {
    setNavSelectedId(null)
    setSearchQuery("")
    setSearchMatchIndex(0)
    setSearchActive(true)
  }

  function closeTranscriptSearch() {
    setSearchActive(false)
    setSearchQuery("")
    setSearchMatchIndex(0)
    setNavSelectedId(null)
  }

  function jumpSearchMatch(delta: number) {
    if (searchMatchIdList.length === 0) return
    setSearchMatchIndex((index) => wrapIndex(index + delta, searchMatchIdList.length))
  }

  const transcriptNavHint = searchActive
    ? null
    : navSelectedId !== null
      ? `↑↓ select · enter ${selectedTranscriptItem()?.role === "activity" ? "expand" : "·"} · y copy${selectedTranscriptItem()?.role === "user" ? " · e edit" : ""} · ^f search · esc exit`
      : null

  useSelectionHandler((selection) => {
    const selectedText = selection.getSelectedText()
    if (!selectedText) return
    lastSelectedTextRef.current = selectedText
    copyTextToClipboard(selectedText)
  })

  // Whether a free-text field currently owns keyboard input. The global ctrl+h
  // home-toggle must not fire in these contexts: some terminals send Backspace as
  // ^H, and there editing (of the composer / a rename / token / target / search
  // field) must win over toggling home. The /home command still reaches home.
  const isTextInputFocused = (): boolean => {
    // When the threads sidebar owns focus, the composer is not the text sink, so
    // global toggles (ctrl+h) should fire rather than being treated as edits.
    if (sidebarActive) return false
    // The in-thread transcript search owns a live text input.
    if (searchActive) return true
    // Conversation composer — also the sink for the slash-command palette and
    // inline "/…" filtering, both of which keep activeOverlay null.
    if (!showHome && activeOverlay === null) return true
    if (activeOverlay === "commands") return true // slash palette filters the composer
    if (activeOverlay === "threads") return true // thread palette search box
    if (activeOverlay === "skills") return true // local skill search-as-you-type
    if (automationRenameActive) return true // automation rename field
    if (extensionSetupInputKey !== null) return true // extension setup field
    if (llmProviderSetupInputKey !== null || llmProviderForm !== null || nearAiWalletInputActive) return true
    if (logEditingTarget) return true // log target filter field
    if (remoteSkillSearching || skillInstall !== null) return true // remote skill search / install form
    if (activeOverlay === "projects" && projectsView === "create") return true // new-project name field
    // Manual-token auth gate exposes a live token input.
    if (state.pendingGate && isAuthGate(state.pendingGate) && isManualTokenGate(state.pendingGate)) return true
    return false
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      clearTitle()
      renderer.destroy()
      return
    }
    if (isCommandCopy(key)) {
      key.preventDefault()
      key.stopPropagation()
      copyTextToClipboard(lastSelectedTextRef.current || textareaRef.current?.plainText || input)
      return
    }
    // ctrl+h toggles the home control room from anywhere (closing any overlay),
    // except while a text input is focused: some terminals send Backspace as ^H,
    // and there the keystroke must edit text, not toggle home (the /home command
    // still opens home from a text field). From non-input contexts ctrl+h works.
    if (key.ctrl && key.name === "h" && !isTextInputFocused()) {
      key.preventDefault()
      key.stopPropagation()
      toggleHome()
      return
    }
    // --- Threads sidebar (conversation view only; no overlay/home on top) ---
    // ctrl+b collapses/expands the sidebar regardless of which pane has focus.
    if (inConversationView && key.ctrl && key.name === "b") {
      key.preventDefault()
      key.stopPropagation()
      setSidebarCollapsed((collapsed) => !collapsed)
      setSidebarFocused(false)
      return
    }
    // While the sidebar owns focus, it captures navigation keys (up/down select,
    // enter opens, tab/esc returns focus to the chat) and swallows the rest so
    // they never reach the composer.
    if (inConversationView && sidebarVisible && sidebarFocused) {
      if (key.name === "tab" || key.name === "escape") {
        key.preventDefault(); key.stopPropagation(); setSidebarFocused(false); return
      }
      if (key.name === "up" || key.name === "k") {
        key.preventDefault(); key.stopPropagation()
        setSidebarIndex((index) => wrapIndex(index - 1, sidebarThreads.length)); return
      }
      if (key.name === "down" || key.name === "j") {
        key.preventDefault(); key.stopPropagation()
        setSidebarIndex((index) => wrapIndex(index + 1, sidebarThreads.length)); return
      }
      if (isPlainEnter(key)) {
        key.preventDefault(); key.stopPropagation()
        const thread = sidebarThreads[wrapIndex(sidebarIndex, sidebarThreads.length)]
        if (thread) void loadThread(thread.id)
        setSidebarFocused(false)
        return
      }
      return
    }
    // From the chat, tab moves focus into the sidebar (unless a gate or the slash
    // palette is claiming tab), seeding the cursor on the active thread.
    if (inConversationView && sidebarVisible && !sidebarFocused && key.name === "tab" && !state.pendingGate && !showSlashCommands) {
      key.preventDefault(); key.stopPropagation()
      const activeIndex = sidebarThreads.findIndex((thread) => thread.id === state.activeThreadId)
      setSidebarIndex(activeIndex >= 0 ? activeIndex : 0)
      setSidebarFocused(true)
      return
    }
    // --- In-thread transcript search (ctrl+f) ---
    // Opens from the composer or from nav mode. The search field captures typing,
    // so `n`/`N` can't drive the jumps (they're valid query chars) — enter /
    // shift+enter jump next / prev instead.
    // Gated on !pendingGate (like up-into-nav): search must not open over an
    // auth/token gate and steal the gate's input.
    if (inConversationView && !sidebarActive && !state.pendingGate && key.ctrl && key.name === "f") {
      key.preventDefault(); key.stopPropagation()
      openTranscriptSearch()
      return
    }
    if (inConversationView && !sidebarActive && searchActive) {
      if (key.name === "escape") { key.preventDefault(); key.stopPropagation(); closeTranscriptSearch(); return }
      // Backspace deletes the last query char. Some terminals send Backspace as
      // ^H ({ctrl, name:"h"}) — treat that as backspace too so chars can be deleted.
      if (key.name === "backspace" || key.name === "delete" || (key.ctrl && key.name === "h")) {
        key.preventDefault(); key.stopPropagation()
        setSearchQuery((q) => q.slice(0, -1)); setSearchMatchIndex(0); return
      }
      if (key.ctrl && key.name === "u") { key.preventDefault(); key.stopPropagation(); setSearchQuery(""); setSearchMatchIndex(0); return }
      if ((key.name === "return" || key.name === "kpenter" || key.name === "linefeed")) {
        key.preventDefault(); key.stopPropagation(); jumpSearchMatch(key.shift ? -1 : 1); return
      }
      const searchText = printableKeyText(key)
      if (searchText) { key.preventDefault(); key.stopPropagation(); setSearchQuery((q) => q + searchText); setSearchMatchIndex(0); return }
      // Swallow other *plain* keys so they can't leak to the composer, but let
      // global ctrl/meta shortcuts (gate approve/deny, ^x cancel, ^t/^m pickers,
      // …) fall through to their handlers below instead of being trapped here.
      if (!key.ctrl && !key.meta) { key.preventDefault(); key.stopPropagation(); return }
    }
    // --- Transcript navigation focus mode ---
    // Reached only when a message is selected (composer / sidebar keep their own
    // focus otherwise). Swallows keys so they never leak to the composer / history.
    if (inConversationView && !sidebarActive && navSelectedId !== null) {
      if (key.name === "escape") { key.preventDefault(); key.stopPropagation(); exitTranscriptNav(); return }
      if (key.name === "up" || key.name === "k") { key.preventDefault(); key.stopPropagation(); moveTranscriptSelection(-1); return }
      if (key.name === "down" || key.name === "j") { key.preventDefault(); key.stopPropagation(); moveTranscriptSelection(1); return }
      if (isPlainEnter(key)) { key.preventDefault(); key.stopPropagation(); activateSelectedTranscriptItem(); return }
      const navText = printableKeyText(key)
      if (navText === "g") { key.preventDefault(); key.stopPropagation(); jumpTranscriptSelection("top"); return }
      if (navText === "G") { key.preventDefault(); key.stopPropagation(); jumpTranscriptSelection("bottom"); return }
      if (navText === "y") { key.preventDefault(); key.stopPropagation(); copySelectedTranscriptItem(); return }
      if (navText === "e") { key.preventDefault(); key.stopPropagation(); editSelectedTranscriptItem(); return }
      // pageup keeps loading older history (handled below). Swallow other *plain*
      // keys so they can't leak to the composer / input history, but let global
      // ctrl/meta shortcuts (gate approve/deny, ^x cancel, ^t/^m pickers, ^b, ^h)
      // fall through to their handlers below.
      if (key.name !== "pageup" && !key.ctrl && !key.meta) { key.preventDefault(); key.stopPropagation(); return }
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
      if (key.name === "up" || key.name === "k") { key.preventDefault(); key.stopPropagation(); setLogOffset((o) => Math.min(o + 1, Math.max(0, logEntries.length - 1))); return }
      if (key.name === "down" || key.name === "j") { key.preventDefault(); key.stopPropagation(); setLogOffset((o) => Math.max(0, o - 1)); return }
      const logKey = printableKeyText(key).toLowerCase()
      if (logKey === "l") { key.preventDefault(); key.stopPropagation(); const nextFilter = { ...logFilter, level: cycleLogLevel(logFilter.level, 1) }; setLogFilter(nextFilter); void loadLogs(nextFilter, true); return }
      if (logKey === "t") { key.preventDefault(); key.stopPropagation(); setLogEditingTarget(true); setLogTargetInput(logFilter.target ?? ""); return }
      if (logKey === "f") { key.preventDefault(); key.stopPropagation(); const nextFilter = { ...logFilter, follow: !logFilter.follow }; setLogFilter(nextFilter); void loadLogs(nextFilter, true); return }
      // Fetch older entries (prepended) and move the window up a page so the
      // newly-fetched entries become visible.
      if (logKey === "o") { key.preventDefault(); key.stopPropagation(); setLogOffset((o) => o + LOG_VISIBLE_LIMIT); void loadOlderLogs(); return }
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
    if (showHome) {
      if (key.name === "escape") {
        key.preventDefault()
        key.stopPropagation()
        setShowHome(false)
        return
      }
      if (key.name === "up" || key.name === "k") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedHomeIndex((index) => wrapIndex(index - 1, Math.max(1, homeSelectableTotal)))
        return
      }
      if (key.name === "down" || key.name === "j" || key.name === "tab") {
        key.preventDefault()
        key.stopPropagation()
        setSelectedHomeIndex((index) => wrapIndex(index + 1, Math.max(1, homeSelectableTotal)))
        return
      }
      if (isPlainEnter(key)) {
        key.preventDefault()
        key.stopPropagation()
        void openHomeSelection()
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
      // Empty composer: up enters transcript-navigation focus mode (selecting the
      // last message). With text in the composer, up keeps recalling input history
      // (never hijacked). `k` is not an entry key — it would shadow typing "k" —
      // but it moves the cursor once nav mode is active.
      if (inConversationView && !sidebarActive && !state.pendingGate && input.trim().length === 0 && selectableTranscriptIdList.length > 0) {
        enterTranscriptNav()
        return
      }
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

  // Mirror render state into refs the SSE / poll effects read.
  useEffect(() => {
    threadsRef.current = state.threads
  }, [state.threads])
  useEffect(() => {
    threadPreviewsRef.current = threadPreviews
  }, [threadPreviews])
  useEffect(() => {
    notifyLevelRef.current = state.notifyLevel
  }, [state.notifyLevel])
  useEffect(() => {
    activeOverlayRef.current = activeOverlay
    // The conversation is the visible surface only when neither the home surface
    // nor any overlay is on top of it — drives notification suppression.
    conversationVisibleRef.current = !showHome && activeOverlay === null
  }, [activeOverlay, showHome])

  // Load persisted client prefs once and apply the saved notify level.
  useEffect(() => {
    const prefs = loadUiPrefs()
    dispatch({ type: "set_notify_level", level: prefs.notifyLevel })
  }, [])

  // Keep the terminal (and tmux window) title flagged with the count of things
  // waiting on the user: pending approvals across threads + the live gate.
  useEffect(() => {
    // The approval inbox already counts the active thread's own gate, so add the
    // live gate only when its thread is not already represented (avoids the
    // "⚑ 2 when 1 pending" double-count). See pendingApprovalTitleCount.
    const total = pendingApprovalTitleCount({
      approvalCount: state.approvalCount,
      pendingGateThreadId: state.pendingGate?.thread_id ?? null,
      approvalThreadIds: approvalThreadIdsRef.current,
    })
    if (total === titleCountRef.current) return
    titleCountRef.current = total
    setPendingTitle(total)
  }, [state.approvalCount, state.pendingGate])

  // Reset the title when the TUI unmounts (quit).
  useEffect(() => {
    return () => clearTitle()
  }, [])

  useEffect(() => {
    // Tick the shared clock while a run is thinking (spinner/elapsed) or while
    // the home surface is up (so its ages stay live). Idle + not-home: no timer.
    if (!state.isThinking && !showHome) return
    setNowMs(Date.now())
    const timer = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(timer)
  }, [state.isThinking, showHome])

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

  // Poll the approval inbox for the status-bar badge, and piggyback a cheap
  // refresh of the home control-room data (automations + trace credits) on the
  // same 30s cadence. Each fetch is guarded so an unchanged result never spawns
  // a re-render, and the automations/credits fetches are skipped while their own
  // overlays are open so a background poll can't clobber in-overlay state.
  useEffect(() => {
    if (!state.connected) return
    let cancelled = false
    // Re-establish the approval baseline for this connection so a reconnect
    // doesn't page the whole backlog that accumulated while disconnected.
    prevApprovalCountRef.current = -1
    async function pollInbox() {
      try {
        const inbox = await client.approvalInbox()
        if (cancelled) return
        const prevCount = prevApprovalCountRef.current
        const prevIds = approvalThreadIdsRef.current
        // Genuinely-new pending approvals on *background* threads (not the active
        // thread, whose own gate already pages over SSE). A pending approval is a
        // blocker, so kind "inbox" is classified blocking (notify.ts) and pages
        // at the default "blockers" level — the whole point of the inbox badge.
        const newBackground = inbox.threads.filter(
          (thread) => thread.thread_id !== activeThreadIdRef.current && !prevIds.has(thread.thread_id),
        )
        // Skip the first poll of a connection (prevCount < 0 baseline): only page
        // once a baseline exists, so a genuinely-new arrival pages and pre-existing
        // backlog does not.
        if (prevCount >= 0 && newBackground.length > 0) {
          const first = newBackground[0]
          maybeNotify({
            kind: "inbox",
            threadId: first.thread_id,
            threadTitle: threadTitleFor(first.thread_id),
            summary: inbox.count === 1 ? "1 thread needs approval" : `${inbox.count} threads need approval`,
          })
        }
        prevApprovalCountRef.current = inbox.count
        approvalThreadIdsRef.current = new Set(inbox.threads.map((thread) => thread.thread_id))
        dispatch({ type: "approval_count", count: inbox.count })
      } catch {
        // ignore; badge stays at its last value
      }
    }
    async function pollHomeData() {
      if (activeOverlayRef.current !== "automations" && activeOverlayRef.current !== "settings") {
        try {
          const response = await client.automations()
          const list = response.automations ?? []
          const sig = list.map((a) => `${a.automation_id}:${a.state}:${a.last_status ?? ""}:${a.next_run_at ?? ""}`).join("|")
          if (!cancelled && sig !== automationsSigRef.current) {
            automationsSigRef.current = sig
            setAutomations(list)
          }
        } catch {
          // leave automations at their last value
        }
      }
      if (activeOverlayRef.current !== "traces") {
        try {
          const credits = await client.traceCredits()
          const sig = String(credits.final_credit)
          if (!cancelled && sig !== homeCreditsSigRef.current) {
            homeCreditsSigRef.current = sig
            setHomeCreditsUsd(credits.final_credit)
          }
        } catch {
          // leave credits at their last value
        }
      }
    }
    void pollInbox()
    void pollHomeData()
    const timer = setInterval(() => {
      void pollInbox()
      void pollHomeData()
    }, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [client, state.connected])

  useEffect(() => {
    const threadId = state.activeThreadId
    if (!threadId) return
    let cancelled = false
    // Abort the in-flight fetch/read and wake the generator's sleeps on cleanup,
    // so a thread switch closes the old stream promptly instead of leaking it
    // against the server's per-user stream cap until the next yield.
    const controller = new AbortController()

    void (async () => {
      // Consumer-side backoff for a *fatal* stream error (client.events re-throws
      // SseTerminalError immediately each reconnect). Escalate so a persistent
      // 401/404 backs off long instead of a fixed-interval request storm. A
      // clean stream end (generator returns) resets it — the generator already
      // paced its own reconnect.
      const SSE_CONSUMER_MIN_MS = 1500
      const SSE_CONSUMER_MAX_MS = 30_000
      let reconnectDelayMs = SSE_CONSUMER_MIN_MS
      while (!cancelled && activeThreadIdRef.current === threadId) {
        try {
          for await (const event of client.events(threadId, undefined, controller.signal)) {
            if (cancelled || activeThreadIdRef.current !== threadId) break
            const eventThreadId = threadIdFromEvent(event)
            if (eventThreadId && eventThreadId !== activeThreadIdRef.current) continue
            // A slash-command ack (e.g. /model, model list) arrives as a
            // `response` frame and is consumed here; don't also page it as a
            // "reply ready" final_reply. Genuine assistant replies also arrive as
            // `response` frames but are not consumed, so they still page.
            const consumedAsCommand = event.type === "response" ? applyModelCommandResponse(event.content) : false
            // Stamp the calendar day so the (pure) run_usage cost reducer can
            // dedup by run_id and roll over "today $" at midnight without Date().
            dispatch({ type: "event", event, dayKey: currentDayKey() })
            if (!consumedAsCommand) {
              // Events replayed from a projection_snapshot on (re)connect are old
              // backlog; maybeNotify records their dedup key but never pages, so a
              // reconnect can't burst notifications for gates/replies/failures the
              // user already saw.
              maybeNotify(notifyEventForAppEvent(event, eventThreadId), { replayed: eventIsReplayed(event) })
            }
            if (isTerminalRunStatusEvent(event)) void refreshThreadFromEvent(eventThreadId)
          }
          reconnectDelayMs = SSE_CONSUMER_MIN_MS
        } catch (error) {
          if (cancelled || activeThreadIdRef.current !== threadId) break
          dispatch({ type: "connected", connected: false, status: "reconnecting" })
          dispatch({ type: "error", message: errorMessage(error) })
          await sleep(reconnectDelayMs)
          reconnectDelayMs = Math.min(reconnectDelayMs * 2, SSE_CONSUMER_MAX_MS)
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [client, state.activeThreadId])

  // Resolve a display title for a thread id from the mirrored refs (usable from
  // the SSE / poll effects). Falls back to the id, then a generic label.
  function threadTitleFor(threadId?: string | null): string {
    if (!threadId) return "New session"
    const thread = threadsRef.current.find((item) => item.id === threadId)
    return thread ? threadDisplayTitle(thread, threadPreviewsRef.current) : threadId
  }

  // Map an SSE frame to a NotifyEvent, or null when the frame is not page-worthy.
  function notifyEventForAppEvent(event: AppEvent, eventThreadId: string | null): NotifyEvent | null {
    switch (event.type) {
      case "gate_required": {
        const kind: NotifyKind = event.gate_name === "auth" || event.challenge_kind ? "auth" : "gate"
        return {
          kind,
          threadId: eventThreadId ?? "",
          threadTitle: threadTitleFor(eventThreadId),
          summary: event.description || event.tool_name || (kind === "auth" ? "authentication required" : "approval required"),
          runId: event.run_id ?? null,
        }
      }
      case "approval_needed":
        return {
          kind: "gate",
          threadId: eventThreadId ?? "",
          threadTitle: threadTitleFor(eventThreadId),
          summary: event.description || event.tool_name || "approval required",
        }
      case "run_status":
        if (!isFailedNotifyStatus(event.status)) return null
        return {
          kind: "failed",
          threadId: eventThreadId ?? "",
          threadTitle: threadTitleFor(eventThreadId),
          summary: event.failure_category ? `run failed: ${event.failure_category}` : "run failed",
          runId: event.run_id ?? null,
        }
      case "response":
        return {
          kind: "final_reply",
          threadId: eventThreadId ?? "",
          threadTitle: threadTitleFor(eventThreadId),
          summary: firstLine(event.content) || "reply ready",
        }
      default:
        return null
    }
  }

  // Page the user for an event, gated by their notify level, whether they're
  // already looking at the thread, and the per-run debounce.
  function maybeNotify(nev: NotifyEvent | null, options?: { replayed?: boolean }) {
    if (!nev) return
    const isActiveThreadVisible =
      Boolean(nev.threadId) && nev.threadId === activeThreadIdRef.current && conversationVisibleRef.current
    const allowed = shouldNotify({ event: nev, level: notifyLevelRef.current, isActiveThreadVisible })
    // Record the dedup key regardless of whether we page right now, so a later
    // un-suppression (surface switch, reconnect replay) can't replay the backlog.
    // The key includes the run id, so an identical event in a *later* run is not
    // swallowed as a repeat while a burst within one run still collapses to one.
    const firstSeen = notifyGateRef.current.seen(notifyDedupKey(nev))
    // Never page for replayed/snapshot backlog; seen() above still records it.
    if (options?.replayed) return
    if (!allowed) return
    if (!firstSeen) return
    notify(nev)
  }

  // Toggle the home control room from anywhere, closing any open overlay.
  function toggleHome() {
    setActiveOverlay(null)
    setSelectedHomeIndex(0)
    setShowHome((visible) => !visible)
  }

  // Enter on the flat home selection: open the target thread (or /automations for
  // a held-automation row).
  async function openHomeSelection(index: number = homeIndex) {
    const target = resolveHomeTarget(homeInputs, homeRecentThreads.map((thread) => thread.id), nowMs, index)
    if (!target) return
    setShowHome(false)
    if (target.kind === "automations") {
      await openAutomationsOverlay()
      return
    }
    await loadThread(target.threadId)
  }

  async function startNewThreadOnConnect(): Promise<string | null> {
    const response = await client.threads()
    const existingThreads = sortThreadsByRecent([response.assistant_thread, ...response.threads].filter(Boolean) as ThreadInfo[])
    const thread = await client.newThread()
    const threads = mergeThreads([thread], existingThreads)

    activeThreadIdRef.current = thread.id
    dispatch({ type: "threads", threads, activeThreadId: thread.id })
    setSelectedThreadIndex(0)
    await loadThread(thread.id)
    // Land on the home control room once the session is ready, rather than
    // dropping straight into the (empty) conversation.
    setShowHome(true)
    setSelectedHomeIndex(0)
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

  async function runAutomationMutation(
    label: string,
    action: () => Promise<AutomationMutationResponse>,
    options?: { refetch?: boolean },
  ) {
    setAutomationMessage(null)
    try {
      const response = await action()
      setAutomationMessage(label)
      // Apply the returned automation record in place when the server echoes it
      // (pause/resume/rename). Only refetch when the record is absent or the row
      // is gone (delete).
      const updated = response.automation
      if (!options?.refetch && updated) {
        setAutomations((current) =>
          current.map((automation) =>
            automation.automation_id === updated.automation_id ? updated : automation,
          ),
        )
      } else {
        await loadAutomations()
      }
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
    await runAutomationMutation("deleted", () => client.deleteAutomation(automation.automation_id), { refetch: true })
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

  async function openSelectedSettingsSection(index: number = selectedSettingsIndex) {
    switch (settingsSectionAt(index)) {
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
      case "Notifications":
        cycleNotifyLevel()
        return
      default:
        return
    }
  }

  // Cycle the notify level off → blockers → all, persisting the choice.
  function cycleNotifyLevel() {
    const order: NotifyLevel[] = ["off", "blockers", "all"]
    const next = order[(order.indexOf(state.notifyLevel) + 1) % order.length] ?? "blockers"
    dispatch({ type: "set_notify_level", level: next })
    saveNotifyLevel(next)
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

  async function openSelectedSkillDetail(index: number = selectedSkillIndex) {
    const skill = filteredSkillList[wrapIndex(index, filteredSkillList.length)]
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

  function selectedExtension(index: number = selectedExtensionIndex): ExtensionRow | null {
    return extensionList[wrapIndex(index, extensionList.length)] ?? null
  }

  async function runSelectedExtensionDefaultAction(index: number = selectedExtensionIndex) {
    const row = selectedExtension(index)
    if (!row) return
    if (!row.installed) {
      await runExtensionAction(() => client.installExtension(row.entry.package_ref))
      return
    }
    if (row.needsSetup) {
      await loadSelectedExtensionSetup(index)
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

  async function loadSelectedExtensionSetup(index: number = selectedExtensionIndex) {
    const row = selectedExtension(index)
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
    // Single routing path: match the first token against the registry. Commands
    // that declare `takesArgs` (e.g. /attach, /save) carry their arguments through
    // one channel; everything else must match the whole line exactly.
    const matched = matchSlashCommand(content, commandSet)
    if (matched) {
      await runSlashCommand(matched.command, matched.args)
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
    const attachments = stagedAttachments
    try {
      const response = await client.send(content, state.activeThreadId, {
        attachments: attachments.length ? attachments.map(toOutgoingAttachment) : undefined,
      })
      const threadId = response.thread_id ?? state.activeThreadId
      if (threadId) activeThreadIdRef.current = threadId
      // A busy thread already has an active run: surface the notice (not an
      // error) and leave the composer text + staged attachments intact so the
      // message isn't lost. Nothing was optimistically committed, so there's
      // nothing to roll back and isThinking is never left stuck true.
      if (response.outcome === "rejected_busy") {
        dispatch({ type: "notice", message: response.notice ?? "A run is already active on this thread." })
        return
      }
      // Accepted (submitted / already_submitted): now commit the optimistic UI —
      // record the user turn, clear the composer + staged attachments, start run.
      applyOutgoingModelCommand(content)
      dispatch({ type: "user_sent", content, threadId })
      clearComposer()
      setStagedAttachments([])
      dispatch({ type: "run_started", threadId, runId: response.run_id, status: response.status })
      if (threadId && threadId !== state.activeThreadId) {
        dispatch({ type: "threads", threads: state.threads, activeThreadId: threadId })
      }
      // No reply polling: the SSE stream (client.events) delivers projection text,
      // final_reply, gates and run status live, and reconnects replay a
      // projection_snapshot — so a history poll would only race the stream and
      // reset status mid-run. Terminal runs still trigger a single history refresh
      // via refreshThreadFromEvent in the SSE consumer.
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  async function runSlashCommand(command: SlashCommand | undefined, args = "") {
    if (!command) return
    switch (command.action) {
      case "home":
        clearComposer()
        setActiveOverlay(null)
        setSelectedHomeIndex(0)
        setShowHome(true)
        return
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
        if (args) await stageAttachmentFromPath(args)
        else dispatch({ type: "notice", message: "usage: /attach <path>" })
        return
      case "save":
        clearComposer()
        if (args) await saveAttachment(args)
        else dispatch({ type: "notice", message: "usage: /save <n>" })
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
        clearTitle()
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
      // The badge only needs the latest reply's attachments; a small page is
      // enough (client.history already filters out the user's own uploads).
      const history = await client.history(threadId, 20)
      const latest = history.message_attachments?.[history.message_attachments.length - 1]
      if (!latest || latest.refs.length === 0) {
        dispatch({ type: "notice", message: "No attachments on the latest reply." })
        return
      }
      const ref = latest.refs[index - 1]
      if (!ref) {
        dispatch({ type: "notice", message: `Attachment ${index} not found (have ${latest.refs.length}).` })
        return
      }
      const bytes = await client.attachment(threadId, latest.message_id, ref.attachment_id)
      const filename = ref.filename || bytes.filename || `attachment-${index}`
      // Never clobber an existing file in the working directory: land on a free
      // numeric-suffixed name (name-1.ext) instead of overwriting.
      const target = await uniqueFilename(filename)
      await Bun.write(target, bytes.bytes)
      dispatch({ type: "notice", message: `saved ${target}` })
    } catch (error) {
      dispatch({ type: "error", message: errorMessage(error) })
    }
  }

  // ---- Retry / inbox / delete thread ----

  async function retryLastRun() {
    const threadId = state.activeThreadId
    // The reducer maintains lastTerminalRunId (set when a run reaches a terminal
    // state, cleared on run_started). When a run is active it is null, so an
    // active run correctly yields the "nothing to retry" notice.
    const runId = state.lastTerminalRunId
    if (!threadId || !runId) {
      dispatch({ type: "notice", message: "No failed or cancelled run to retry." })
      return
    }
    try {
      const response = await client.retryRun(threadId, runId)
      dispatch({ type: "run_started", threadId, runId: response.run_id, status: response.status })
      // The SSE stream carries the retried run's live progress + reply; see submitContent.
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

  function selectedRemoteSkill(index: number = remoteSkillIndex): SkillInfo | null {
    return filteredRemoteSkills[wrapIndex(index, filteredRemoteSkills.length)] ?? null
  }

  async function openRemoteSkillDetail(index: number = remoteSkillIndex) {
    const skill = selectedRemoteSkill(index)
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
    const nextValue = !skill.auto_activate
    try {
      await client.setSkillAutoActivate(skill.name, nextValue)
      // Flip the flag in place on success (same pattern as the learned toggle);
      // a full refetch is only needed to recover the true state on error.
      setRemoteSkills((current) =>
        current.map((item) => (item.name === skill.name ? { ...item, auto_activate: nextValue } : item)),
      )
    } catch (error) {
      setRemoteSkillMessage(errorMessage(error))
      await loadRemoteSkills()
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
    if (reset) setLogOffset(0)
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
      // No per-endpoint catch: a real failure must surface as an error, not be
      // silently swallowed into a null that reads as "not enrolled". A genuine
      // not-enrolled account returns 200 with empty/enrolled=false data.
      const [credits, account] = await Promise.all([client.traceCredits(), client.traceAccount()])
      setTraceCredits(credits)
      setTraceAccount(account)
    } catch (error) {
      setTraceCredits(null)
      setTraceAccount(null)
      setTracesError(`${errorMessage(error)} — press r to retry`)
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

  async function openFsEntry(index: number = fsSelectedIndex) {
    if (workspaceView.kind !== "browse") return
    const entry = fsEntries[wrapIndex(index, fsEntries.length)]
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
      const entries = response.entries ?? []
      setToolRows(toolPermissionRows(entries))
      // Seed the toggle from the actual settings/tools entry; only fall back to
      // the session feature flag when the entry is absent.
      const globalFromEntries = globalAutoApproveFromEntries(entries)
      setToolsGlobalAutoApprove(globalFromEntries ?? Boolean(state.session?.features.global_auto_approve))
    } catch (error) {
      setToolsError(errorMessage(error))
    } finally {
      setToolsLoading(false)
    }
  }

  async function cycleSelectedToolPermission(index: number = selectedToolIndex) {
    const row = toolRows[wrapIndex(index, toolRows.length)]
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
      const response = await client.setSettingsToolsAutoApprove(next)
      // Apply the server's echoed entry rather than assuming our optimistic
      // value stuck — the server may coerce or reject the change.
      const applied = globalAutoApproveFromEntries([response.entry]) ?? next
      setToolsGlobalAutoApprove(applied)
      setToolsMessage(`global auto-approve ${applied ? "on" : "off"}`)
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

  async function setSelectedOutboundTarget(index: number = selectedOutboundIndex) {
    const option = outboundTargets[wrapIndex(index, outboundTargets.length)]
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

  const composerWidth = clamp(width - 8, 42, 82)
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
    onModelRowClick: (index: number) => void selectModel(index),
    onThreadRowClick: (index: number) => void selectThread(index),
    onSlashCommandClick: (command: SlashCommand) => void runSlashCommand(command),
  }

  // --- Mouse: per-surface row click handlers ---
  // A left click reuses the SAME selection index + activate path the keyboard
  // uses: it sets the surface's selected index and (for navigation/picker rows)
  // runs that row's primary/enter action with the clicked index. Multi-action
  // surfaces (Automations, Projects, LLM providers, Channels, Traces holds) are
  // select-only — a click just moves the highlight, leaving the destructive /
  // ambiguous action keys to the user.
  const onHomeRowClick = (index: number) => { setSelectedHomeIndex(index); void openHomeSelection(index) }
  const onSettingsRowClick = (index: number) => { setSelectedSettingsIndex(index); void openSelectedSettingsSection(index) }
  const onSkillRowClick = (index: number) => { setSelectedSkillIndex(index); void openSelectedSkillDetail(index) }
  const onRemoteSkillRowClick = (index: number) => { setRemoteSkillIndex(index); void openRemoteSkillDetail(index) }
  const onToolRowClick = (index: number) => { setSelectedToolIndex(index); void cycleSelectedToolPermission(index) }
  const onOutboundRowClick = (index: number) => { setSelectedOutboundIndex(index); void setSelectedOutboundTarget(index) }
  const onExtensionRowClick = (index: number) => {
    setSelectedExtensionIndex(index)
    setExtensionSetup(null)
    void runSelectedExtensionDefaultAction(index)
  }
  const onWorkspaceRowClick = (index: number) => {
    setFsSelectedIndex(index)
    if (workspaceView.kind === "mounts") {
      const mount = fsMounts[index]
      if (mount) void browseFs(mount.mount, "")
    } else if (workspaceView.kind === "browse") {
      void openFsEntry(index)
    }
  }
  const onSidebarThreadClick = (threadId: string) => { setSidebarFocused(false); void loadThread(threadId) }
  // Select-only surfaces.
  const onAutomationRowClick = (index: number) => setSelectedAutomationIndex(index)
  const onChannelRowClick = (index: number) => setSelectedChannelIndex(index)
  const onProjectRowClick = (index: number) => setSelectedProjectIndex(index)
  const onTraceHoldClick = (index: number) => setSelectedHoldIndex(index)
  const onLlmProviderRowClick = (index: number) => {
    setSelectedLlmProviderIndex(index)
    setLlmProviderModels([])
    setLlmProviderSetupInputKey(null)
    setLlmProviderForm(null)
    setNearAiWalletInputActive(false)
    setNearAiWalletInput("")
  }
  // Transcript: clicking a text message enters transcript-nav on it. A pending
  // gate owns interaction, so a click must not steal the gate's input; and the
  // id must be a real selectable anchor. (Tool/activity cards keep their own
  // expand-toggle click.)
  const onSelectTranscriptMessage = (id: string) => {
    if (state.pendingGate) return
    if (!selectableTranscriptIdList.includes(id)) return
    setSearchActive(false)
    setNavSelectedId(id)
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
          onRowClick={onAutomationRowClick}
        />
      ) : showChannels ? (
        <ChannelsSurface
          channels={channels}
          error={channelsError}
          height={height}
          loading={channelsLoading}
          selectedIndex={wrapIndex(selectedChannelIndex, channels.length)}
          width={width}
          onRowClick={onChannelRowClick}
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
          onRowClick={onExtensionRowClick}
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
          onRowClick={onSkillRowClick}
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
          onRowClick={onLlmProviderRowClick}
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
          notifyLevel={state.notifyLevel}
          status={state.status}
          width={width}
          onRowClick={onSettingsRowClick}
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
          onRowClick={onRemoteSkillRowClick}
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
          offset={logOffset}
          loading={logsLoading}
          error={logsError}
          width={width}
          height={height}
          onScroll={(direction) =>
            direction === "up"
              ? setLogOffset((o) => Math.min(o + 3, Math.max(0, logEntries.length - 1)))
              : setLogOffset((o) => Math.max(0, o - 3))
          }
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
          onHoldClick={onTraceHoldClick}
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
          onRowClick={onWorkspaceRowClick}
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
          onRowClick={onProjectRowClick}
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
          onRowClick={onToolRowClick}
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
          onRowClick={onOutboundRowClick}
        />
      ) : showHome ? (
        <HomeSurface
          needsYou={homeNeedsYou}
          active={homeActive}
          automations={buildAutomationsSummary(automations, homeSchedulerEnabled)}
          recent={homeRecentThreads}
          threadPreviews={threadPreviews}
          vitals={buildVitals(homeInputs)}
          selectedIndex={homeIndex}
          focused={homeFocusSection(homeIndex, homeNeedsYou.length, homeActive.length)}
          width={width}
          height={height}
          onRowClick={onHomeRowClick}
        />
      ) : hasConversation ? (
        <box style={{ width, height, flexDirection: "row", backgroundColor: theme.bg }}>
          {sidebarLayout.visible ? (
            <ThreadsSidebar
              threads={sidebarThreads}
              activeThreadId={state.activeThreadId}
              selectedIndex={sidebarIndex}
              focused={sidebarFocused}
              threadPreviews={threadPreviews}
              dotContext={{ activeThreadId: state.activeThreadId, activeRunning: state.isThinking, approvalThreadIds }}
              width={sidebarLayout.sidebarWidth}
              height={height}
              onSelect={onSidebarThreadClick}
            />
          ) : null}
          <box style={{ flexGrow: 1, height, flexDirection: "column" }}>
            <ConversationSurface
              contentWidth={chatContentWidth}
              composer={composer}
              composerWidth={chatContentWidth}
              chatFocused={!sidebarActive && !navMode}
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
              selectedTranscriptId={navSelectedId}
              searchMatchIds={searchMatchIdSet}
              searchActive={searchActive}
              searchQuery={searchQuery}
              searchMatchIndex={searchMatchIndex}
              navHint={transcriptNavHint}
              onToggleActivityExpanded={toggleActivityExpanded}
              onSelectMessage={onSelectTranscriptMessage}
              onResolve={(action) => void resolveGate(action)}
              onSelectGateAction={setSelectedGateAction}
              onSubmitAuthToken={() => void submitAuthToken()}
              onCancelAuthGate={() => void cancelAuthGate()}
              onOpenAuthUrl={(gate) => void openAuthUrl(gate)}
            />
          </box>
        </box>
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

// Find a filename in the working directory that doesn't already exist, adding a
// numeric suffix before the extension (report.pdf → report-1.pdf) so /save never
// overwrites a prior file.
async function uniqueFilename(name: string): Promise<string> {
  if (!(await Bun.file(name).exists())) return name
  const dot = name.lastIndexOf(".")
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  for (let counter = 1; counter < 1000; counter += 1) {
    const candidate = `${base}-${counter}${ext}`
    if (!(await Bun.file(candidate).exists())) return candidate
  }
  return `${base}-${Date.now()}${ext}`
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

// Trigger a history refresh for EVERY terminal run status the reducer recognizes
// (completed/done/succeeded/failed/cancelled/canceled/killed/recovery_required),
// normalized the same way. A subset here would silently drop the reply for runs
// that end 'succeeded'/'done' whose reply arrived only via the timeline — the
// spinner clears but refreshThreadFromEvent never fires, so the reply never shows.
function isTerminalRunStatusEvent(event: AppEvent): event is Extract<AppEvent, { type: "run_status" }> {
  if (event.type !== "run_status") return false
  return isTerminalRunState(event.status)
}

// Run statuses that page the user as a "failed" notification. Cancelled is a
// user-initiated stop and never pages.
function isFailedNotifyStatus(status: string): boolean {
  return ["failed", "killed", "recovery_required"].includes(status.trim().toLowerCase().replace(/[-\s]+/g, "_"))
}

// Which home section the flat selection index falls in, for header emphasis.
function homeFocusSection(index: number, needsYouLen: number, activeLen: number): HomeSection | undefined {
  if (index < 0) return undefined
  if (index < needsYouLen) return "needsYou"
  if (index < needsYouLen + activeLen) return "active"
  return "recent"
}

function firstLine(text: string): string {
  const line = (text ?? "").split("\n").find((part) => part.trim().length > 0) ?? ""
  const trimmed = line.trim()
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed
}

function threadIdFromEvent(event: AppEvent): string | null {
  if (!("thread_id" in event)) return null
  return typeof event.thread_id === "string" ? event.thread_id : null
}

// True for an event replayed from a projection_snapshot on (re)connect (old
// backlog) rather than a live incremental update. Used to suppress re-paging.
function eventIsReplayed(event: AppEvent): boolean {
  return (event as { replayed?: boolean }).replayed === true
}

// Current calendar-day key (e.g. "2026-07-18"), stamped onto event dispatch so
// the pure run_usage cost reducer can roll "today $" over at midnight and dedup
// by run_id without reaching for Date() itself.
function currentDayKey(): string {
  return new Date().toISOString().slice(0, 10)
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
