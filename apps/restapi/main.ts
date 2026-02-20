import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import type { AppActions, SetStatus } from '../_shared/app-types'
import { appendEventLog } from '../_shared/log'
import { fetchAsText } from './http'
import {
  clampIndex,
  displayName,
  getTagFilterLabel,
  parseTagsInput,
  RestCommandStore,
  TAG_ALL,
  toGlassLabel,
  type RestCommand,
} from './model'
import {
  clearCommandInput,
  ensureUi,
  getSelectedCommandId,
  rebuildCommandSelect,
  rebuildTagFilterSelect,
  readCommandInput,
  syncSelectByCommandId,
  syncTagFilter,
  type RestUiState,
} from './ui'

const PROXY_PATH = '/__restapi_proxy'

type BridgeDisplay = {
  mode: 'bridge' | 'mock'
  show: (message: string) => Promise<void>
  renderList: (commands: RestCommand[], selectedIndex: number, statusMessage?: string) => Promise<void>
  onSelectAndRun: (runner: (command: RestCommand) => Promise<void>) => void
}

const store = new RestCommandStore()

const bridgeState: {
  bridge: EvenAppBridge | null
  startupRendered: boolean
  eventLoopRegistered: boolean
  selectedIndex: number
  statusMessage: string
  activeTagFilter: string
  onSelectAndRun: ((command: RestCommand) => Promise<void>) | null
} = {
  bridge: null,
  startupRendered: false,
  eventLoopRegistered: false,
  selectedIndex: 0,
  statusMessage: 'Select command and click',
  activeTagFilter: TAG_ALL,
  onSelectAndRun: null,
}

let bridgeDisplay: BridgeDisplay | null = null
let activeUi: RestUiState | null = null

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => window.clearTimeout(timer))
  })
}

function getFilteredCommands(): RestCommand[] {
  return store.filtered(bridgeState.activeTagFilter)
}

function buildFilterStatus(): string {
  const filtered = getFilteredCommands()
  return `Filter: ${getTagFilterLabel(bridgeState.activeTagFilter)} | ${filtered.length} cmd(s)`
}

function getRawEventType(event: EvenHubEvent): unknown {
  const raw = (event.jsonData ?? {}) as Record<string, unknown>
  return (
    event.listEvent?.eventType ??
    event.textEvent?.eventType ??
    event.sysEvent?.eventType ??
    (event as Record<string, unknown>).eventType ??
    raw.eventType ??
    raw.event_type ??
    raw.Event_Type ??
    raw.type
  )
}

function normalizeEventType(rawEventType: unknown): OsEventTypeList | undefined {
  if (typeof rawEventType === 'number') {
    switch (rawEventType) {
      case 0:
        return OsEventTypeList.CLICK_EVENT
      case 1:
        return OsEventTypeList.SCROLL_TOP_EVENT
      case 2:
        return OsEventTypeList.SCROLL_BOTTOM_EVENT
      case 3:
        return OsEventTypeList.DOUBLE_CLICK_EVENT
      default:
        return undefined
    }
  }

  if (typeof rawEventType === 'string') {
    const value = rawEventType.toUpperCase()
    if (value.includes('DOUBLE')) return OsEventTypeList.DOUBLE_CLICK_EVENT
    if (value.includes('CLICK')) return OsEventTypeList.CLICK_EVENT
    if (value.includes('SCROLL_TOP') || value.includes('UP')) return OsEventTypeList.SCROLL_TOP_EVENT
    if (value.includes('SCROLL_BOTTOM') || value.includes('DOWN')) return OsEventTypeList.SCROLL_BOTTOM_EVENT
  }

  return undefined
}

function parseIncomingSelection(
  event: EvenHubEvent,
  labels: string[],
): { index: number; hasExplicitIndex: boolean } {
  const incomingIndexRaw = event.listEvent?.currentSelectItemIndex
  const incomingName = event.listEvent?.currentSelectItemName
  const incomingIndexByName = typeof incomingName === 'string'
    ? labels.indexOf(incomingName)
    : -1

  const parsedIncomingIndex = typeof incomingIndexRaw === 'number'
    ? incomingIndexRaw
    : typeof incomingIndexRaw === 'string'
      ? Number.parseInt(incomingIndexRaw, 10)
      : incomingIndexByName

  if (Number.isFinite(parsedIncomingIndex) && parsedIncomingIndex >= 0) {
    return { index: parsedIncomingIndex, hasExplicitIndex: true }
  }

  // Simulator can omit index/name; keep current selection for navigation semantics.
  return { index: -1, hasExplicitIndex: false }
}

function syncBrowserSelectionByCommandId(commandId: number): void {
  if (!activeUi) {
    return
  }
  syncSelectByCommandId(activeUi.select, commandId)
}

function syncBrowserTagFilter(tagFilter: string): void {
  if (!activeUi) {
    return
  }
  syncTagFilter(activeUi.tagFilterSelect, tagFilter)
}

function selectedCommandFromUi(): RestCommand | null {
  if (!activeUi) {
    return null
  }

  const selectedId = getSelectedCommandId(activeUi.select)
  if (!selectedId) {
    return null
  }

  return store.findById(selectedId)
}

function refreshUiData(preferredCommandId?: number): void {
  if (!activeUi) {
    return
  }

  rebuildCommandSelect(activeUi.select, store.list(), preferredCommandId)
  rebuildTagFilterSelect(activeUi.tagFilterSelect, store.availableTags(), bridgeState.activeTagFilter)

  bridgeState.activeTagFilter = activeUi.tagFilterSelect.value
  const selected = selectedCommandFromUi()
  const filtered = getFilteredCommands()

  if (!selected || filtered.length === 0) {
    bridgeState.selectedIndex = 0
    return
  }

  const indexInFiltered = filtered.findIndex((command) => command.id === selected.id)
  bridgeState.selectedIndex = indexInFiltered >= 0 ? indexInFiltered : 0
}

function getMockBridgeDisplay(): BridgeDisplay {
  return {
    mode: 'mock',
    async show() {
      // No-op in mock mode.
    },
    async renderList() {
      // No-op in mock mode.
    },
    onSelectAndRun(runner) {
      void runner
    },
  }
}

async function renderBridgePage(
  bridge: EvenAppBridge,
  commands: RestCommand[],
  selectedIndex: number,
  statusMessage: string,
): Promise<void> {
  const safeCommands = commands.length > 0
    ? commands
    : [{ id: 0, url: 'N/A', name: 'No command configured', tags: [] } satisfies RestCommand]
  const safeSelected = clampIndex(selectedIndex, safeCommands.length)

  const titleText = new TextContainerProperty({
    containerID: 1,
    containerName: 'restapi-title',
    content: 'REST API (Click run, Dbl tag)',
    xPosition: 8,
    yPosition: 0,
    width: 560,
    height: 34,
    isEventCapture: 0,
  })

  const statusText = new TextContainerProperty({
    containerID: 2,
    containerName: 'restapi-status',
    content: statusMessage,
    xPosition: 8,
    yPosition: 36,
    width: 560,
    height: 62,
    isEventCapture: 0,
  })

  const listContainer = new ListContainerProperty({
    containerID: 3,
    containerName: 'restapi-command-list',
    itemContainer: new ListItemContainerProperty({
      itemCount: safeCommands.length,
      itemWidth: 566,
      isItemSelectBorderEn: 1,
      itemName: safeCommands.map((command) => toGlassLabel(command)),
    }),
    isEventCapture: 1,
    xPosition: 4,
    yPosition: 102,
    width: 572,
    height: 186,
  })

  const config = {
    containerTotalNum: 3,
    textObject: [titleText, statusText],
    listObject: [listContainer],
    currentSelectedItem: safeSelected,
  }

  if (!bridgeState.startupRendered) {
    await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
    bridgeState.startupRendered = true
    return
  }

  await bridge.rebuildPageContainer(new RebuildPageContainer(config))
}

async function updateBridgeStatusText(bridge: EvenAppBridge, message: string): Promise<boolean> {
  try {
    const updated = await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 2,
      containerName: 'restapi-status',
      contentOffset: 0,
      contentLength: Math.max(1, message.length),
      content: message,
    }))
    return Boolean(updated)
  } catch {
    return false
  }
}

function registerBridgeEvents(bridge: EvenAppBridge): void {
  if (bridgeState.eventLoopRegistered) {
    return
  }

  bridge.onEvenHubEvent(async (event) => {
    const filteredCommands = getFilteredCommands()
    if (filteredCommands.length === 0) {
      return
    }

    const labels = filteredCommands.map((command) => toGlassLabel(command))
    const rawEventType = getRawEventType(event)
    let eventType = normalizeEventType(rawEventType)

    const incoming = parseIncomingSelection(event, labels)
    const hasIncomingIndex = incoming.hasExplicitIndex && incoming.index < filteredCommands.length

    if (eventType === undefined && event.listEvent) {
      // Keep parity with base_app behavior: ambiguous list events default to click.
      eventType = OsEventTypeList.CLICK_EVENT
    }

    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      bridgeState.activeTagFilter = store.nextTagFilter(bridgeState.activeTagFilter)
      bridgeState.selectedIndex = 0
      syncBrowserTagFilter(bridgeState.activeTagFilter)
      bridgeState.statusMessage = buildFilterStatus()

      await renderBridgePage(bridge, getFilteredCommands(), bridgeState.selectedIndex, bridgeState.statusMessage)
      appendEventLog(`REST API glass: switched filter to ${getTagFilterLabel(bridgeState.activeTagFilter)}`)
      return
    }

    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      bridgeState.selectedIndex = clampIndex(
        hasIncomingIndex ? incoming.index : bridgeState.selectedIndex + 1,
        filteredCommands.length,
      )

      const selected = filteredCommands[bridgeState.selectedIndex]
      if (selected) {
        syncBrowserSelectionByCommandId(selected.id)
      }

      appendEventLog(`REST API glass: down -> ${displayName(filteredCommands[bridgeState.selectedIndex])}`)
      return
    }

    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      bridgeState.selectedIndex = clampIndex(
        hasIncomingIndex ? incoming.index : bridgeState.selectedIndex - 1,
        filteredCommands.length,
      )

      const selected = filteredCommands[bridgeState.selectedIndex]
      if (selected) {
        syncBrowserSelectionByCommandId(selected.id)
      }

      appendEventLog(`REST API glass: up -> ${displayName(filteredCommands[bridgeState.selectedIndex])}`)
      return
    }

    if (eventType === OsEventTypeList.CLICK_EVENT || (eventType === undefined && event.listEvent)) {
      const selectedIndex = hasIncomingIndex
        ? clampIndex(incoming.index, filteredCommands.length)
        : 0

      bridgeState.selectedIndex = selectedIndex
      const selectedCommand = filteredCommands[selectedIndex]
      if (!selectedCommand) {
        return
      }

      syncBrowserSelectionByCommandId(selectedCommand.id)
      appendEventLog(`REST API glass: run ${displayName(selectedCommand)}`)

      const run = bridgeState.onSelectAndRun
      if (run) {
        await run(selectedCommand)
      }
    }
  })

  bridgeState.eventLoopRegistered = true
}

function getBridgeDisplay(): BridgeDisplay {
  if (!bridgeState.bridge) {
    throw new Error('Bridge unavailable')
  }

  return {
    mode: 'bridge',
    async show(message: string) {
      bridgeState.statusMessage = message
      const bridge = bridgeState.bridge!
      const updated = await updateBridgeStatusText(bridge, bridgeState.statusMessage)
      if (updated) {
        return
      }

      const filteredCommands = getFilteredCommands()
      bridgeState.selectedIndex = clampIndex(bridgeState.selectedIndex, filteredCommands.length)
      await renderBridgePage(bridge, filteredCommands, bridgeState.selectedIndex, bridgeState.statusMessage)
    },
    async renderList(commands: RestCommand[], selectedIndex: number, statusMessage?: string) {
      bridgeState.selectedIndex = clampIndex(selectedIndex, commands.length)
      if (statusMessage) {
        bridgeState.statusMessage = statusMessage
      }
      await renderBridgePage(bridgeState.bridge!, commands, bridgeState.selectedIndex, bridgeState.statusMessage)
    },
    onSelectAndRun(runner) {
      bridgeState.onSelectAndRun = runner
    },
  }
}

async function initBridgeDisplay(timeoutMs = 4000): Promise<BridgeDisplay> {
  try {
    bridgeState.bridge = await withTimeout(waitForEvenAppBridge(), timeoutMs)
    registerBridgeEvents(bridgeState.bridge)

    if (!bridgeDisplay || bridgeDisplay.mode !== 'bridge') {
      bridgeDisplay = getBridgeDisplay()
    }

    return bridgeDisplay
  } catch {
    bridgeState.bridge = null
    bridgeState.startupRendered = false
    bridgeState.statusMessage = 'Select command and click'
    bridgeDisplay = getMockBridgeDisplay()
    return bridgeDisplay
  }
}

export function createRestApiActions(setStatus: SetStatus): AppActions {
  let uiInitialized = false
  let isFetching = false

  const runRequestByCommand = async (command: RestCommand): Promise<void> => {
    if (!activeUi) {
      return
    }

    if (isFetching) {
      setStatus('Request already in progress')
      appendEventLog('REST API: request ignored (already in progress)')
      return
    }

    setStatus(`Fetching ${command.url} ...`)
    appendEventLog(`REST API: GET ${command.url} (${displayName(command)})`)

    if (bridgeDisplay) {
      await bridgeDisplay.show(`Loading ${displayName(command)}...`)
    }

    isFetching = true
    try {
      const { statusLine, body } = await fetchAsText(PROXY_PATH, command.url)
      const preview = body.length > 200 ? `${body.slice(0, 200)}...` : body

      activeUi.response.textContent = body
      setStatus(`GET complete: ${statusLine}`)
      appendEventLog(`REST API: ${statusLine}`)
      appendEventLog(`REST API response preview: ${preview.replace(/\n/g, ' ')}`)

      if (bridgeDisplay) {
        const compactPreview = preview.replace(/\s+/g, ' ').slice(0, 96)
        const bridgeMessage = `${displayName(command)} ${statusLine}\n${compactPreview}`
        await bridgeDisplay.show(bridgeMessage)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      activeUi.response.textContent = `Request failed:\n${message}`
      setStatus('GET failed')
      appendEventLog(`REST API: request failed (${message})`)

      if (bridgeDisplay) {
        await bridgeDisplay.show(`GET failed: ${message.slice(0, 80)}`)
      }
    } finally {
      isFetching = false
    }
  }

  const syncBridgeList = (): void => {
    if (!activeUi || !bridgeDisplay || bridgeDisplay.mode !== 'bridge') {
      return
    }

    const filtered = getFilteredCommands()
    bridgeState.selectedIndex = clampIndex(bridgeState.selectedIndex, filtered.length)
    bridgeState.statusMessage = buildFilterStatus()
    void bridgeDisplay.renderList(filtered, bridgeState.selectedIndex, bridgeState.statusMessage)
  }

  const bindUiEvents = (): void => {
    if (!activeUi) {
      return
    }

    activeUi.select.onchange = () => {
      const selected = selectedCommandFromUi()
      if (!selected) {
        bridgeState.selectedIndex = 0
        syncBridgeList()
        return
      }

      const filtered = getFilteredCommands()
      const idx = filtered.findIndex((command) => command.id === selected.id)
      bridgeState.selectedIndex = idx >= 0 ? idx : 0
      syncBridgeList()
    }

    activeUi.tagFilterSelect.onchange = () => {
      bridgeState.activeTagFilter = activeUi!.tagFilterSelect.value
      bridgeState.selectedIndex = 0
      appendEventLog(`REST API: tag filter set to ${getTagFilterLabel(bridgeState.activeTagFilter)}`)
      syncBridgeList()
    }

    activeUi.addButton.onclick = () => {
      const input = readCommandInput(activeUi!)
      if (!input.url) {
        setStatus('Enter a URL before adding')
        return
      }

      const parsedTags = parseTagsInput(input.tagsInput)
      const { command, created } = store.upsert(input.url, input.name, parsedTags)
      refreshUiData(command.id)
      clearCommandInput(activeUi!)

      if (created) {
        setStatus(`Added command: ${displayName(command)}`)
        appendEventLog(`REST API: added command ${command.url}`)
      } else {
        setStatus(`Updated command: ${displayName(command)}`)
        appendEventLog(`REST API: updated command ${command.url}`)
      }

      syncBridgeList()
    }

    activeUi.removeButton.onclick = () => {
      const selectedId = getSelectedCommandId(activeUi!.select)
      if (!selectedId) {
        setStatus('No command selected')
        return
      }

      const removed = store.removeById(selectedId)
      refreshUiData()

      if (!removed) {
        setStatus('No command selected')
        return
      }

      setStatus(`Removed command: ${displayName(removed)}`)
      appendEventLog(`REST API: removed command ${removed.url}`)
      syncBridgeList()
    }
  }

  return {
    async connect() {
      activeUi = ensureUi()
      refreshUiData()

      if (!uiInitialized) {
        bindUiEvents()
        uiInitialized = true
      }

      bridgeDisplay = await initBridgeDisplay()
      bridgeDisplay.onSelectAndRun(runRequestByCommand)

      const selected = selectedCommandFromUi()
      if (selected) {
        const filtered = getFilteredCommands()
        const index = filtered.findIndex((command) => command.id === selected.id)
        bridgeState.selectedIndex = index >= 0 ? index : 0
      }

      if (bridgeDisplay.mode === 'bridge') {
        syncBridgeList()
        setStatus('REST API ready. Up/Down select, Click run, Double-click switches tag filter.')
        appendEventLog('REST API: controls initialized (bridge mode)')
      } else {
        setStatus('REST API controls ready. Bridge not found, browser mode active.')
        appendEventLog('REST API: controls initialized (mock mode)')
      }
    },

    async action() {
      if (!activeUi) {
        setStatus('Run setup first')
        appendEventLog('REST API: request blocked (setup not run)')
        return
      }

      const selected = selectedCommandFromUi()
      if (!selected) {
        setStatus('No command selected')
        appendEventLog('REST API: request blocked (no command selected)')
        return
      }

      await runRequestByCommand(selected)
    },
  }
}
