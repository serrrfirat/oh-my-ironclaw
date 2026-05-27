import type { SyntaxStyle, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useEffect, useRef, useState, type RefObject } from "react"
import type { PendingGateInfo, ThreadInfo } from "../gateway/types"
import { threadDisplayTitle, type ThreadPreviewMap } from "../threadPreviews"
import { transcriptItemContentLength, type TranscriptItem } from "../transcript"
import { activityGroupSummary, groupTranscriptEntries } from "./activityGroups"
import { TranscriptMessage } from "./TranscriptMessage"
import { sourceColor, type SlashCommand } from "./slashCommands"

export type GateAction = "approved" | "denied"

const SLASH_COMMAND_POPUP_LIMIT = 8
const THREAD_PALETTE_LIMIT = 10

export type ComposerCommonProps = {
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
  threadPreviews: ThreadPreviewMap
  threadSearch: string
  thinkingLabel: string
  activeThreadId?: string | null
  models: string[]
  threads: ThreadInfo[]
  onInputChange: () => void
  onSubmit: () => void
}

export function WelcomeSurface({
  baseUrl,
  composerWidth,
  composer,
  connected,
  height,
  lastError,
  localDevYolo,
  status,
  width,
}: {
  baseUrl: string
  composerWidth: number
  composer: ComposerCommonProps
  connected: boolean
  height: number
  lastError?: string | null
  localDevYolo: boolean
  status: string
  width: number
}) {
  const topSpacer = Math.max(1, Math.floor(height * 0.32) - 5)
  const logoColors = useRainbowLogoColors(localDevYolo)
  const logoText = localDevYolo ? "IRONCLAW" : "ironclaw"
  return (
    <box style={{ width, height, flexDirection: "column", alignItems: "center", backgroundColor: "#050505" }}>
      <box style={{ height: topSpacer }} />
      {height >= 15 ? (
        <box style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <ascii-font text={logoText} font="block" color={logoColors} backgroundColor="#050505" />
          {localDevYolo ? <YoloSplashTag /> : null}
        </box>
      ) : (
        <text fg={logoColors[0] ?? "#8cffb0"}>{logoText}</text>
      )}
      <box style={{ height: 2 }} />
      <Composer
        focused
        {...composer}
        showThinkingStatus
        width={composerWidth}
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

export function ConversationSurface({
  composerWidth,
  composer,
  contentWidth,
  height,
  lastError,
  markdownStyle,
  pendingGate,
  selectedGateAction,
  showOlderHistoryHint,
  transcript,
  expandedActivityIds,
  onToggleActivityExpanded,
  onResolve,
  onSelectGateAction,
}: {
  composerWidth: number
  composer: ComposerCommonProps
  contentWidth: number
  height: number
  lastError?: string | null
  markdownStyle: SyntaxStyle
  pendingGate: PendingGateInfo | null
  selectedGateAction: GateAction
  showOlderHistoryHint: boolean
  transcript: TranscriptItem[]
  expandedActivityIds: Set<string>
  onToggleActivityExpanded: (id: string) => void
  onResolve: (action: GateAction) => void
  onSelectGateAction: (action: GateAction) => void
}) {
  const slashPopupHeight = composer.showSlashCommands ? slashCommandPopupHeight(composer.slashCommands) : 0
  const threadPopupHeight = composer.showThreadPalette ? threadPaletteHeight(composer.threads) : 0
  const modelPopupHeight = composer.showModelPalette ? modelPaletteHeight(composer.models) : 0
  const transcriptHeight = Math.max(6, height - (pendingGate ? 16 : 8) - slashPopupHeight - threadPopupHeight - modelPopupHeight)
  const transcriptScrollRef = useRef<ScrollBoxRenderable>(null)
  const transcriptEndKey = transcript.map((item) => `${item.id}:${transcriptItemContentLength(item)}`).join("|")
  const transcriptEntries = groupTranscriptEntries(transcript)

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
        {transcriptEntries.map((entry) => entry.kind === "activity_group" ? (
          <ActivityGroup
            key={entry.id}
            expanded={expandedActivityIds.has(entry.id)}
            expandedActivityIds={expandedActivityIds}
            groupId={entry.id}
            items={entry.items}
            markdownStyle={markdownStyle}
            selectedModel={composer.selectedModel}
            spinner={composer.spinner}
            width={contentWidth}
            onToggleActivityExpanded={onToggleActivityExpanded}
          />
        ) : (
          <TranscriptMessage
            key={entry.item.id}
            item={entry.item}
            expanded={expandedActivityIds.has(entry.item.id)}
            markdownStyle={markdownStyle}
            selectedModel={composer.selectedModel}
            spinner={composer.spinner}
            width={contentWidth}
            onToggleActivityExpanded={onToggleActivityExpanded}
          />
        ))}
        {composer.isThinking ? (
          <ThinkingMessage
            selectedModel={composer.selectedModel}
            spinner={composer.spinner}
            thinkingLabel={composer.thinkingLabel}
            width={contentWidth}
          />
        ) : null}
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
        {...composer}
        showThinkingStatus={false}
        width={composerWidth}
      />
      {lastError ? <StatusLine connected={false} status="error" message={lastError} width={composerWidth} /> : null}
    </box>
  )
}

function ThinkingMessage({
  selectedModel,
  spinner,
  thinkingLabel,
  width,
}: {
  selectedModel: string
  spinner: string
  thinkingLabel: string
  width: number
}) {
  return (
    <box style={{ width, flexDirection: "column", paddingLeft: 3, paddingRight: 2, marginBottom: 2 }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg="#2ee66b">{spinner}</text>
        <text fg="#2ee66b"> Build</text>
        <text fg="#777777"> · </text>
        <text fg="#d0d0d0">{selectedModel}</text>
        <text fg="#777777"> · {thinkingLabel}</text>
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

function ActivityGroup({
  expanded,
  expandedActivityIds,
  groupId,
  items,
  markdownStyle,
  selectedModel,
  spinner,
  width,
  onToggleActivityExpanded,
}: {
  expanded: boolean
  expandedActivityIds: Set<string>
  groupId: string
  items: Array<Extract<TranscriptItem, { role: "activity" }>>
  markdownStyle: SyntaxStyle
  selectedModel: string
  spinner: string
  width: number
  onToggleActivityExpanded: (id: string) => void
}) {
  return (
    <box style={{ width, flexDirection: "column", marginBottom: 2 }}>
      <box
        onMouseDown={() => onToggleActivityExpanded(groupId)}
        style={{ width, height: 1, flexDirection: "row", paddingLeft: 3, paddingRight: 2 }}
      >
        <text fg="#777777">{expanded ? "▾ " : "▸ "}</text>
        <text fg="#777777">{truncate(activityGroupSummary(items), Math.max(1, width - 7))}</text>
      </box>
      {expanded ? items.map((item) => (
        <TranscriptMessage
          key={item.id}
          item={item}
          expanded={expandedActivityIds.has(item.id)}
          markdownStyle={markdownStyle}
          selectedModel={selectedModel}
          spinner={spinner}
          width={width}
          onToggleActivityExpanded={onToggleActivityExpanded}
        />
      )) : null}
    </box>
  )
}

function YoloSplashTag() {
  return (
    <box style={{ width: 16, height: 3, flexDirection: "column", marginLeft: 0, marginTop: 2 }}>
      <text fg="#fff36d">     yolo</text>
      <text fg="#ffb86b">   mode</text>
      <text fg="#ff7ad9"> on!</text>
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
  showThinkingStatus = true,
  spinner,
  threadPreviews,
  threadSearch,
  thinkingLabel,
  activeThreadId,
  models,
  threads,
  width,
  onInputChange,
  onSubmit,
}: {
  focused: boolean
  showThinkingStatus?: boolean
  width: number
} & ComposerCommonProps) {
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
          threadPreviews={threadPreviews}
          threadSearch={threadSearch}
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
            {isThinking && showThinkingStatus ? <text fg={railColor}> {spinner} {thinkingLabel}</text> : null}
          </box>
        </box>
      </box>
    </box>
  )
}

function ThreadPalette({
  activeThreadId,
  selectedIndex,
  threadPreviews,
  threadSearch,
  threads,
  width,
}: {
  activeThreadId?: string | null
  selectedIndex: number
  threadPreviews: ThreadPreviewMap
  threadSearch: string
  threads: ThreadInfo[]
  width: number
}) {
  const selectedThreadIndex = wrapIndex(selectedIndex, threads.length)
  const startIndex = Math.min(
    Math.max(0, selectedThreadIndex - THREAD_PALETTE_LIMIT + 1),
    Math.max(0, threads.length - THREAD_PALETTE_LIMIT),
  )
  const visibleThreads = threads.slice(startIndex, startIndex + THREAD_PALETTE_LIMIT)
  const rangeLabel = threads.length > visibleThreads.length
    ? `${startIndex + 1}-${startIndex + visibleThreads.length}/${threads.length}`
    : `${threads.length}`
  return (
    <box style={{ width, flexDirection: "column", backgroundColor: "#171717", paddingTop: 1, paddingBottom: 1 }}>
      <box style={{ height: 2, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg="#e8e8e8">Sessions</text>
        <text fg="#777777">{padLeft("esc", Math.max(1, width - 10))}</text>
      </box>
      <box style={{ height: 2, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg="#ffb887">{threadSearch ? "" : " "}</text>
        <text fg={threadSearch ? "#f0f0f0" : "#8a8a8a"}>{truncate(threadSearch || "Search", width - 4)}</text>
      </box>
      {visibleThreads.length ? (
        visibleThreads.map((thread, index) => (
          <ThreadRow
            key={thread.id}
            active={thread.id === activeThreadId}
            selected={startIndex + index === selectedThreadIndex}
            threadPreviews={threadPreviews}
            thread={thread}
            width={width}
          />
        ))
      ) : (
        <box style={{ height: 3, flexDirection: "column", paddingLeft: 2, paddingRight: 2 }}>
          <text fg="#777777">No results found</text>
        </box>
      )}
      <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, marginTop: 1 }}>
        <text fg="#f0f0f0">new</text>
        <text fg="#777777"> /new   </text>
        <text fg="#f0f0f0">open</text>
        <text fg="#777777"> enter   </text>
        <text fg="#f0f0f0">search</text>
        <text fg="#777777"> type   </text>
        <text fg="#777777">{rangeLabel}</text>
      </box>
    </box>
  )
}

function ThreadRow({
  active,
  selected,
  thread,
  threadPreviews,
  width,
}: {
  active: boolean
  selected: boolean
  thread: ThreadInfo
  threadPreviews: ThreadPreviewMap
  width: number
}) {
  const marker = selected ? ">" : active ? "*" : " "
  const title = threadDisplayTitle(thread, threadPreviews)
  const suffix = active ? " active" : ""
  return (
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, backgroundColor: selected ? "#ffb887" : "#171717" }}>
      <text fg={selected ? "#101010" : active ? "#8cffb0" : "#707070"}>{marker} </text>
      <text fg={selected ? "#101010" : "#d0d0d0"}>{truncate(title, Math.max(8, width - suffix.length - 8))}</text>
      <text fg={selected ? "#101010" : active ? "#8cffb0" : "#777777"}>{suffix}</text>
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
  const sourceWidth = 9
  const descriptionWidth = Math.max(10, width - commandWidth - sourceWidth - 8)
  return (
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, backgroundColor: selected ? "#1b1b1b" : "#111111" }}>
      <text fg={selected ? "#2ee66b" : "#707070"}>{marker} </text>
      <text fg={selected ? "#8cffb0" : "#d0d0d0"}>{padEnd(command.name, commandWidth)}</text>
      <text fg={sourceColor(command.source)}>{padEnd(command.source, sourceWidth)}</text>
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

function padLeft(value: string, length: number): string {
  return value.length >= length ? value.slice(0, length) : " ".repeat(length - value.length) + value
}

function commandPopupHint(start: number, count: number, total: number): string {
  const range = total > count ? ` · ${start + 1}-${start + count}/${total}` : ""
  return `up/down select · enter run · esc close${range}`
}

function slashCommandPopupHeight(commands: SlashCommand[]): number {
  return Math.min(commands.length, SLASH_COMMAND_POPUP_LIMIT) + 3
}

function threadPaletteHeight(threads: ThreadInfo[]): number {
  return Math.min(Math.max(threads.length, 1), THREAD_PALETTE_LIMIT) + 6
}

function modelPaletteHeight(models: string[]): number {
  return Math.min(Math.max(models.length, 1), 8) + 3
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

function useRainbowLogoColors(active: boolean): string[] {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!active) {
      setFrame(0)
      return
    }

    const timer = setInterval(() => {
      setFrame((current) => current + 1)
    }, 90)

    return () => clearInterval(timer)
  }, [active])

  if (!active) return ["#0f7a3a", "#8cffb0"]

  const rainbow = ["#ff5c7a", "#ffb86b", "#fff36d", "#57f287", "#5fd7ff", "#8a7cff", "#ff7ad9", "#ffffff"]
  const shine = frame % rainbow.length
  return rainbow.map((_, index) => rainbow[(index + shine) % rainbow.length] ?? "#ffffff")
}
