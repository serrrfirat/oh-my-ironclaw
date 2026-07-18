import type { SyntaxStyle, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useEffect, useRef, useState, type RefObject } from "react"
import type { PendingGateInfo, ThreadInfo } from "../gateway/types"
import type { RunUsageCost } from "../state"
import { attachmentChipLabel, type StagedAttachment } from "./attachments"
import { threadDisplayTitle, type ThreadPreviewMap } from "../threadPreviews"
import { transcriptItemContentLength, type TranscriptItem } from "../transcript"
import { activityGroupSummary, groupTranscriptEntries } from "./activityGroups"
import { TranscriptMessage } from "./TranscriptMessage"
import { sourceColor, type SlashCommand } from "./slashCommands"
import { theme } from "./theme"
import { Tag } from "./pixel"

export type GateAction = "approved" | "denied" | "always"

const SLASH_COMMAND_POPUP_LIMIT = 8
const THREAD_PALETTE_LIMIT = 10

export type ComposerCommonProps = {
  inputRef: RefObject<TextareaRenderable | null>
  connected: boolean
  isThinking: boolean
  railColor: string
  turnElapsedMs?: number | null
  selectedSlashCommandIndex: number
  selectedModel: string
  selectedProvider: string
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
  approvalCount: number
  usageCost?: RunUsageCost | null
  notice?: string | null
  stagedAttachments: StagedAttachment[]
  threadDeleteConfirm?: boolean
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
    <box style={{ width, height, flexDirection: "column", alignItems: "center", backgroundColor: theme.bg }}>
      <box style={{ height: topSpacer }} />
      {height >= 15 ? (
        <box style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <ascii-font text={logoText} font="block" color={logoColors} backgroundColor={theme.bg} />
          {localDevYolo ? <YoloSplashTag /> : null}
        </box>
      ) : (
        <text fg={logoColors[0] ?? theme.accentText}>{logoText}</text>
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
      <text fg={theme.textMuted}>
        <span fg={theme.warn}>* Tip</span> Press <span fg={theme.text}>ctrl+z</span> to suspend the terminal and return to your shell
      </text>
      {lastError ? (
        <box style={{ height: 1, width: composerWidth }}>
          <text fg={theme.textMuted}>
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
  authTokenInput,
  authTokenError,
  authTokenSubmitting,
  showOlderHistoryHint,
  transcript,
  expandedActivityIds,
  onToggleActivityExpanded,
  onResolve,
  onSelectGateAction,
  onSubmitAuthToken,
  onCancelAuthGate,
  onOpenAuthUrl,
}: {
  composerWidth: number
  composer: ComposerCommonProps
  contentWidth: number
  height: number
  lastError?: string | null
  markdownStyle: SyntaxStyle
  pendingGate: PendingGateInfo | null
  selectedGateAction: GateAction
  authTokenInput: string
  authTokenError?: string | null
  authTokenSubmitting: boolean
  showOlderHistoryHint: boolean
  transcript: TranscriptItem[]
  expandedActivityIds: Set<string>
  onToggleActivityExpanded: (id: string) => void
  onResolve: (action: GateAction) => void
  onSelectGateAction: (action: GateAction) => void
  onSubmitAuthToken: () => void
  onCancelAuthGate: () => void
  onOpenAuthUrl: (gate: PendingGateInfo) => void
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
    <box style={{ height, flexDirection: "column", alignItems: "center", backgroundColor: theme.bg, paddingTop: 1 }}>
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
            expanded={!expandedActivityIds.has(entry.id)}
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
            expanded={entry.item.role === "activity" ? !expandedActivityIds.has(entry.item.id) : expandedActivityIds.has(entry.item.id)}
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
            turnElapsedMs={composer.turnElapsedMs}
            width={contentWidth}
          />
        ) : null}
      </scrollbox>
      {pendingGate ? (
        isAuthGate(pendingGate) ? (
          <AuthGatePanel
            error={authTokenError}
            gate={pendingGate}
            submitting={authTokenSubmitting}
            token={authTokenInput}
            width={composerWidth}
            onCancel={onCancelAuthGate}
            onOpenUrl={() => onOpenAuthUrl(pendingGate)}
            onSubmit={onSubmitAuthToken}
          />
        ) : (
          <GatePanel
            gate={pendingGate}
            selectedAction={selectedGateAction}
            width={composerWidth}
            onSelect={onSelectGateAction}
            onResolve={onResolve}
          />
        )
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

function isAuthGate(gate: PendingGateInfo): boolean {
  return gate.gate_name === "auth"
}

function ThinkingMessage({
  selectedModel,
  spinner,
  thinkingLabel,
  turnElapsedMs,
  width,
}: {
  selectedModel: string
  spinner: string
  thinkingLabel: string
  turnElapsedMs?: number | null
  width: number
}) {
  return (
    <box style={{ width, flexDirection: "column", paddingLeft: 3, paddingRight: 2, marginBottom: 2 }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg={theme.accent}>{spinner}</text>
        <text fg={theme.accent}> Build</text>
        <text fg={theme.textMuted}> · </text>
        <text fg={theme.text}>{selectedModel}</text>
        {typeof turnElapsedMs === "number" ? <text fg={theme.textMuted}> · {formatDuration(turnElapsedMs)}</text> : null}
        <text fg={theme.textMuted}> · {thinkingLabel}</text>
      </box>
    </box>
  )
}

function LoadOlderHint({ width }: { width: number }) {
  return (
    <box style={{ width, height: 2, flexDirection: "column", paddingLeft: 3, marginBottom: 1 }}>
      <text fg={theme.textMuted}>{truncate("/history or pageup to load older messages", Math.max(1, width - 3))}</text>
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
        <text fg={theme.textMuted}>{expanded ? "▾ " : "▸ "}</text>
        <text fg={theme.textMuted}>{truncate(activityGroupSummary(items), Math.max(1, width - 7))}</text>
      </box>
      {expanded ? items.map((item) => (
        <TranscriptMessage
          key={item.id}
          item={item}
          expanded={!expandedActivityIds.has(item.id)}
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
  connected,
  focused,
  inputRef,
  isThinking,
  railColor,
  turnElapsedMs,
  selectedSlashCommandIndex,
  selectedModel,
  selectedProvider,
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
  approvalCount,
  usageCost,
  notice,
  stagedAttachments,
  threadDeleteConfirm,
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
      {notice ? (
        <box style={{ width, height: 1, flexDirection: "row" }}>
          <text fg={theme.textFaint}>◦ {truncate(notice, Math.max(1, width - 3))}</text>
        </box>
      ) : null}
      {stagedAttachments.length ? (
        <box style={{ width, height: 1, flexDirection: "row" }}>
          <text fg={theme.accentText}>{truncate(stagedAttachments.map((item) => `[${attachmentChipLabel(item)}]`).join(" "), width)}</text>
        </box>
      ) : null}
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
          deleteConfirm={Boolean(threadDeleteConfirm)}
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
      <box style={{ width, height: 6, flexDirection: "row", backgroundColor: theme.bgSoft }}>
        <box style={{ width: 1, backgroundColor: isThinking ? railColor : theme.accent }} />
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
          <textarea
            ref={inputRef}
            focused={focused}
            placeholder={'Ask anything... "What is the tech stack of this project?"'}
            initialValue=""
            backgroundColor={theme.bgSoft}
            focusedBackgroundColor={theme.bgSoft}
            textColor={theme.text}
            focusedTextColor={theme.textStrong}
            placeholderColor={theme.textFaint}
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
            <text fg={theme.accent}>Build</text>
            <text fg={theme.textMuted}> . </text>
            <text fg={theme.text}>{selectedModel}</text>
            {selectedProvider ? <text fg={theme.textMuted}> {selectedProvider}</text> : null}
            {!connected ? <text fg={theme.danger}> · ! disconnected</text> : null}
            {usageCostSummary(usageCost, activeThreadId) ? <text fg={theme.textFaint}> · {usageCostSummary(usageCost, activeThreadId)}</text> : null}
            {approvalCount > 0 ? <text fg={theme.warn}> · {approvalCount} {approvalCount === 1 ? "approval" : "approvals"}</text> : null}
            {typeof turnElapsedMs === "number" ? <text fg={theme.textMuted}> · {formatDuration(turnElapsedMs)}</text> : null}
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
  deleteConfirm,
  width,
}: {
  activeThreadId?: string | null
  selectedIndex: number
  threadPreviews: ThreadPreviewMap
  threadSearch: string
  threads: ThreadInfo[]
  deleteConfirm?: boolean
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
    <box style={{ width, flexDirection: "column", backgroundColor: theme.bgSoft, paddingTop: 1, paddingBottom: 1 }}>
      <box style={{ height: 2, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg={theme.textStrong}>Sessions</text>
        <text fg={theme.textMuted}>{padLeft("esc", Math.max(1, width - 10))}</text>
      </box>
      <box style={{ height: 2, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg={theme.warn}>{threadSearch ? "" : " "}</text>
        <text fg={threadSearch ? theme.textStrong : theme.textMuted}>{truncate(threadSearch || "Search", width - 4)}</text>
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
          <text fg={theme.textMuted}>No results found</text>
        </box>
      )}
      {deleteConfirm ? (
        <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, marginTop: 1 }}>
          <text fg={theme.danger}>delete selected thread? y confirm · n cancel</text>
        </box>
      ) : (
        <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, marginTop: 1 }}>
          <text fg={theme.textStrong}>new</text>
          <text fg={theme.textMuted}> /new   </text>
          <text fg={theme.textStrong}>open</text>
          <text fg={theme.textMuted}> enter   </text>
          <text fg={theme.textStrong}>del</text>
          <text fg={theme.textMuted}> ctrl+d   </text>
          <text fg={theme.textMuted}>{rangeLabel}</text>
        </box>
      )}
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
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, backgroundColor: selected ? theme.accentSoftBg : theme.bgSoft }}>
      <text fg={selected ? theme.accentText : active ? theme.accentText : theme.textMuted}>{marker} </text>
      <text fg={selected ? theme.accentText : theme.text}>{truncate(title, Math.max(8, width - suffix.length - 8))}</text>
      <text fg={selected ? theme.accentText : active ? theme.accentText : theme.textMuted}>{suffix}</text>
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
    <box style={{ width, flexDirection: "column", backgroundColor: theme.bgCode, paddingTop: 1, paddingBottom: 1 }}>
      <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg={theme.accentText}>models</text>
        <text fg={theme.textMuted}> · up/down select · enter use · esc close</text>
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
        <text fg={theme.textFaint}>{truncate("sends /model through Reborn command workflow", Math.max(1, width - 4))}</text>
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
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, backgroundColor: selected ? theme.bgSoft : theme.bgCode }}>
      <text fg={selected || active ? theme.accent : theme.textMuted}>{marker} </text>
      <text fg={selected ? theme.textStrong : theme.text}>{truncate(model, Math.max(8, width - suffix.length - 8))}</text>
      <text fg={active ? theme.accentText : theme.textMuted}>{suffix}</text>
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
    <box style={{ width, flexDirection: "column", backgroundColor: theme.bgCode, paddingTop: 1, paddingBottom: 1 }}>
      {visibleCommands.map((command, index) => (
        <SlashCommandRow
          key={command.name}
          command={command}
          selected={start + index === selected}
          width={width}
        />
      ))}
      <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <text fg={theme.textFaint}>{truncate(commandPopupHint(start, visibleCommands.length, commands.length), width - 4)}</text>
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
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, backgroundColor: selected ? theme.bgSoft : theme.bgCode }}>
      <text fg={selected ? theme.accent : theme.textMuted}>{marker} </text>
      <text fg={selected ? theme.accentText : theme.text}>{padEnd(command.name, commandWidth)}</text>
      <text fg={sourceColor(command.source)}>{padEnd(command.source, sourceWidth)}</text>
      <text fg={theme.textMuted}>{truncate(command.description, descriptionWidth)}</text>
    </box>
  )
}

function HintLine({ width }: { width: number }) {
  return (
    <box style={{ width, height: 1, flexDirection: "row", justifyContent: "flex-end" }}>
      <text fg={theme.text}>ctrl+p</text>
      <text fg={theme.textMuted}> commands   </text>
      <text fg={theme.text}>ctrl+t</text>
      <text fg={theme.textMuted}> threads   </text>
      <text fg={theme.text}>ctrl+m</text>
      <text fg={theme.textMuted}> model   </text>
      <text fg={theme.text}>ctrl+x</text>
      <text fg={theme.textMuted}> cancel</text>
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
      <text fg={connected ? theme.ok : theme.danger}>{connected ? "online" : "offline"} | {status}</text>
      <text fg={theme.textMuted}>{truncate(baseUrl ? `${message} | ${baseUrl}` : message, width)}</text>
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
  const context = gate.approval_context ?? null
  const contextLines = approvalContextLines(context)
  const allowAlways = Boolean(gate.allow_always)
  const height = 8 + Math.min(contextLines.length, 3) + (allowAlways ? 0 : 0)
  return (
    <box
      focused
      // Pixel: warnSoftBg strip + 3px warn left rail, square corners.
      style={{ width, height, flexDirection: "row", backgroundColor: theme.warnSoftBg }}
    >
      <box style={{ width: 1, backgroundColor: theme.warn }} />
      <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
        <box style={{ height: 1, flexDirection: "row" }}>
          <Tag label="approval" tone="warn" />
          <text fg={theme.warn}> {truncate(context?.tool_name ?? gate.tool_name, width - 16)}</text>
        </box>
        <text fg={theme.text}>{truncate(context?.action ?? gate.description, width - 6)}</text>
        {context?.scope || context?.destination ? (
          <text fg={theme.textMuted}>{truncate([context?.scope, context?.destination].filter(Boolean).join(" → "), width - 6)}</text>
        ) : (
          <text fg={theme.textMuted}>{truncate(gate.parameters, width - 6)}</text>
        )}
        {contextLines.slice(0, 3).map((line, index) => (
          <text key={`gate-ctx-${index}`} fg={theme.textFaint}>{truncate(`· ${line}`, width - 6)}</text>
        ))}
        <box style={{ flexDirection: "row", height: 3, marginTop: 1 }}>
          <GateButton label="Approve" action="approved" selected={selectedAction === "approved"} onSelect={onSelect} onResolve={onResolve} />
          <box style={{ width: 2 }} />
          {allowAlways ? (
            <>
              <GateButton label="Always" action="always" selected={selectedAction === "always"} onSelect={onSelect} onResolve={onResolve} />
              <box style={{ width: 2 }} />
            </>
          ) : null}
          <GateButton label="Deny" action="denied" selected={selectedAction === "denied"} onSelect={onSelect} onResolve={onResolve} />
          <text fg={theme.textFaint}>  ctrl+a approve{allowAlways ? " · w always" : ""} · ctrl+d deny</text>
        </box>
      </box>
    </box>
  )
}

function approvalContextLines(context: PendingGateInfo["approval_context"]): string[] {
  if (!context) return []
  return (context.details ?? []).filter((line): line is string => typeof line === "string" && line.length > 0)
}

function AuthGatePanel({
  error,
  gate,
  submitting,
  token,
  width,
  onCancel,
  onOpenUrl,
  onSubmit,
}: {
  error?: string | null
  gate: PendingGateInfo
  submitting: boolean
  token: string
  width: number
  onCancel: () => void
  onOpenUrl: () => void
  onSubmit: () => void
}) {
  const challengeKind = authChallengeKind(gate)
  if (challengeKind === "oauth_url") {
    return <OAuthGatePanel error={error} gate={gate} width={width} onCancel={onCancel} onOpenUrl={onOpenUrl} />
  }
  if (challengeKind !== "manual_token") {
    return <GenericAuthGatePanel error={error} gate={gate} width={width} onCancel={onCancel} onOpenUrl={onOpenUrl} />
  }

  const masked = token ? "*".repeat(Math.min(token.length, Math.max(1, width - 12))) : "Paste access token"
  return (
    <box
      focused
      style={{ width, height: 10, backgroundColor: theme.accentSoftBg, flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}
    >
      <AuthGateHeader gate={gate} width={width} />
      <text fg={theme.text}>{truncate(gate.description, width - 6)}</text>
      <AuthProviderLine gate={gate} width={width} />
      <box style={{ height: 1 }} />
      <box style={{ height: 3, border: true, borderColor: theme.accent, backgroundColor: theme.accentSoftBg, paddingLeft: 1, paddingRight: 1 }}>
        <text fg={token ? theme.textStrong : theme.textMuted}>{truncate(masked, width - 10)}</text>
      </box>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg={error ? theme.danger : theme.textMuted}>
          {truncate(error || (submitting ? "checking token..." : "type token, enter submit, esc cancel"), width - 6)}
        </text>
      </box>
      <box style={{ height: 2, flexDirection: "row", marginTop: 1 }}>
        <AuthGateButton label={submitting ? "Checking" : "Use token"} primary disabled={submitting} onClick={onSubmit} />
        <box style={{ width: 2 }} />
        <AuthGateButton label="Cancel" disabled={submitting} onClick={onCancel} />
      </box>
    </box>
  )
}

function OAuthGatePanel({
  error,
  gate,
  width,
  onCancel,
  onOpenUrl,
}: {
  error?: string | null
  gate: PendingGateInfo
  width: number
  onCancel: () => void
  onOpenUrl: () => void
}) {
  return (
    <box
      focused
      style={{ width, height: 10, backgroundColor: theme.accentSoftBg, flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}
    >
      <AuthGateHeader gate={gate} width={width} />
      <text fg={theme.text}>{truncate(gate.description, width - 6)}</text>
      <AuthProviderLine gate={gate} width={width} />
      <AuthExpiryLine expiresAt={gate.expires_at} width={width} />
      <text fg={theme.textMuted}>{truncate(gate.authorization_url || "No authorization URL provided", width - 6)}</text>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg={error ? theme.danger : theme.textMuted}>{truncate(error || "o open browser, esc cancel", width - 6)}</text>
      </box>
      <box style={{ height: 2, flexDirection: "row", marginTop: 1 }}>
        <AuthGateButton label="Open" primary disabled={!gate.authorization_url} onClick={onOpenUrl} />
        <box style={{ width: 2 }} />
        <AuthGateButton label="Cancel" onClick={onCancel} />
      </box>
    </box>
  )
}

function GenericAuthGatePanel({
  error,
  gate,
  width,
  onCancel,
  onOpenUrl,
}: {
  error?: string | null
  gate: PendingGateInfo
  width: number
  onCancel: () => void
  onOpenUrl: () => void
}) {
  const hasUrl = Boolean(gate.authorization_url)
  return (
    <box
      focused
      style={{ width, height: 10, backgroundColor: theme.accentSoftBg, flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}
    >
      <AuthGateHeader gate={gate} width={width} />
      <text fg={theme.text}>{truncate(gate.description || "Authentication required.", width - 6)}</text>
      <AuthProviderLine gate={gate} width={width} />
      <AuthExpiryLine expiresAt={gate.expires_at} width={width} />
      <text fg={theme.textMuted}>{truncate(hasUrl ? gate.authorization_url || "" : "Continue in the connected auth flow.", width - 6)}</text>
      <box style={{ height: 1, flexDirection: "row" }}>
        <text fg={error ? theme.danger : theme.textMuted}>{truncate(error || (hasUrl ? "o open browser, esc cancel" : "esc cancel"), width - 6)}</text>
      </box>
      <box style={{ height: 2, flexDirection: "row", marginTop: 1 }}>
        {hasUrl ? <AuthGateButton label="Open" primary onClick={onOpenUrl} /> : null}
        {hasUrl ? <box style={{ width: 2 }} /> : null}
        <AuthGateButton label="Cancel" onClick={onCancel} />
      </box>
    </box>
  )
}

function AuthGateHeader({ gate, width }: { gate: PendingGateInfo; width: number }) {
  return (
    <box style={{ height: 1, flexDirection: "row" }}>
      <text fg={theme.accentText}>! </text>
      <text fg={theme.textStrong}>{truncate(gate.tool_name || "Authentication required", width - 8)}</text>
    </box>
  )
}

function AuthProviderLine({ gate, width }: { gate: PendingGateInfo; width: number }) {
  const provider = gate.provider ?? "auth"
  const label = gate.account_label ?? "Authentication"
  return <text fg={theme.textMuted}>{truncate(`${provider} · ${label}`, width - 6)}</text>
}

function AuthExpiryLine({ expiresAt, width }: { expiresAt?: string | null; width: number }) {
  const text = expiresAt ? `Link may expire: ${expiresAt}` : "Link may expire."
  return <text fg={theme.textMuted}>{truncate(text, width - 6)}</text>
}

function authChallengeKind(gate: PendingGateInfo): string {
  return gate.challenge_kind || "manual_token"
}

function AuthGateButton({
  disabled,
  label,
  primary,
  onClick,
}: {
  disabled?: boolean
  label: string
  primary?: boolean
  onClick: () => void
}) {
  const borderColor = disabled ? theme.border : primary ? theme.accent : theme.border
  const backgroundColor = disabled ? theme.bgSoft : primary ? theme.accentSoftBg : theme.bgSoft
  const textColor = disabled ? theme.textMuted : primary ? theme.accentText : theme.text
  return (
    <box
      focusable={!disabled}
      onMouseUp={() => {
        if (!disabled) onClick()
      }}
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
      <text fg={textColor}>{label}</text>
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
  const tone = action === "approved" ? "ok" : action === "always" ? "accent" : "danger"
  const backgroundColor = selected
    ? tone === "ok"
      ? theme.okSoftBg
      : tone === "accent"
        ? theme.accentStrong
        : theme.dangerSoftBg
    : theme.bgSoft
  const borderColor = selected ? (tone === "ok" ? theme.ok : tone === "accent" ? theme.accent : theme.danger) : theme.border
  const textColor = selected
    ? tone === "accent"
      ? theme.onAccent
      : theme.textStrong
    : tone === "ok"
      ? theme.ok
      : tone === "accent"
        ? theme.accentText
        : theme.danger

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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

// Render usage/cost only when it belongs to the current thread context. A value
// tagged with a different thread (or a leftover from a prior run/thread) is
// stale and must not be shown against the active composer.
function usageCostSummary(usageCost?: RunUsageCost | null, activeThreadId?: string | null): string | null {
  if (!usageCost) return null
  if (usageCost.threadId && activeThreadId && usageCost.threadId !== activeThreadId) return null
  const usage = usageCost.usage
  const cost = usageCost.cost
  const parts: string[] = []
  if (usage) parts.push(`${formatTokens(usage.input_tokens)}↑ ${formatTokens(usage.output_tokens)}↓`)
  if (cost?.total_cost_usd) {
    const total = Number(cost.total_cost_usd)
    if (Number.isFinite(total)) parts.push(`$${total.toFixed(total < 0.01 ? 4 : 2)}`)
  }
  return parts.length ? parts.join(" · ") : null
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  return `${(count / 1000).toFixed(1)}k`
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

  if (!active) return [theme.accent, theme.accentText]

  const rainbow = ["#ff5c7a", "#ffb86b", "#fff36d", "#57f287", "#5fd7ff", "#8a7cff", "#ff7ad9", "#ffffff"]
  const shine = frame % rainbow.length
  return rainbow.map((_, index) => rainbow[(index + shine) % rainbow.length] ?? "#ffffff")
}
