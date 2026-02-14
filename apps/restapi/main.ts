import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import type { AppActions, SetStatus } from '../_shared/app-types'
import { appendEventLog } from '../_shared/log'

const DEFAULT_URLS = [
  'http://livingkitchen.local/rest/system/clock',
  'http://livingkitchen.local/rest/rgb/toggle',
] as const

const PROXY_PATH = '/__restapi_proxy'

type RestUiState = {
  root: HTMLDivElement
  select: HTMLSelectElement
  response: HTMLPreElement
  addInput: HTMLInputElement
  addButton: HTMLButtonElement
  removeButton: HTMLButtonElement
}

type BridgeDisplay = {
  mode: 'bridge' | 'mock'
  show: (message: string) => Promise<void>
  renderList: (urls: string[], selectedIndex: number, statusMessage?: string) => Promise<void>
  onSelectAndRun: (runner: (index: number) => Promise<void>) => void
}

const bridgeState: {
  bridge: EvenAppBridge | null
  startupRendered: boolean
  eventLoopRegistered: boolean
  selectedIndex: number
  statusMessage: string
  onSelectAndRun: ((index: number) => Promise<void>) | null
} = {
  bridge: null,
  startupRendered: false,
  eventLoopRegistered: false,
  selectedIndex: 0,
  statusMessage: 'Select URL and click',
  onSelectAndRun: null,
}

let bridgeDisplay: BridgeDisplay | null = null

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => window.clearTimeout(timer))
  })
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

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.max(0, Math.min(length - 1, index))
}

function toListLabel(url: string): string {
  if (url.length <= 62) return url
  return `${url.slice(0, 59)}...`
}

function getMockBridgeDisplay(): BridgeDisplay {
  return {
    mode: 'mock',
    async show() {
      // No-op when simulator bridge is unavailable.
    },
    async renderList() {
      // No-op when simulator bridge is unavailable.
    },
    onSelectAndRun(runner) {
      void runner
    },
  }
}

async function renderBridgePage(
  bridge: EvenAppBridge,
  urls: string[],
  selectedIndex: number,
  statusMessage: string,
): Promise<void> {
  const safeUrls = urls.length > 0 ? urls : ['No URL configured']
  const safeSelected = clampIndex(selectedIndex, safeUrls.length)

  const titleText = new TextContainerProperty({
    containerID: 1,
    containerName: 'restapi-title',
    content: 'REST API (Up/Down + Click)',
    xPosition: 8,
    yPosition: 0,
    width: 560,
    height: 32,
    isEventCapture: 0,
  })

  const statusText = new TextContainerProperty({
    containerID: 2,
    containerName: 'restapi-status',
    content: statusMessage,
    xPosition: 8,
    yPosition: 34,
    width: 560,
    height: 64,
    isEventCapture: 0,
  })

  const listContainer = new ListContainerProperty({
    containerID: 3,
    containerName: 'restapi-url-list',
    itemContainer: new ListItemContainerProperty({
      itemCount: safeUrls.length,
      itemWidth: 566,
      isItemSelectBorderEn: 1,
      itemName: safeUrls.map((value) => toListLabel(value)),
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

function registerBridgeEvents(bridge: EvenAppBridge): void {
  if (bridgeState.eventLoopRegistered) {
    return
  }

  bridge.onEvenHubEvent(async (event) => {
    const urls = getActiveUrls()
    if (urls.length === 0) {
      return
    }
    const labels = urls.map((url) => toListLabel(url))

    const rawEventType = getRawEventType(event)
    let eventType = normalizeEventType(rawEventType)

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
    // Some simulator list click events omit index/name for first row; treat as index 0.
    const incomingIndex = event.listEvent && (Number.isNaN(parsedIncomingIndex) || parsedIncomingIndex < 0)
      ? 0
      : parsedIncomingIndex
    const hasIncomingIndex = incomingIndex >= 0 && incomingIndex < urls.length

    if (eventType === undefined && event.listEvent) {
      if (hasIncomingIndex && incomingIndex > bridgeState.selectedIndex) {
        eventType = OsEventTypeList.SCROLL_BOTTOM_EVENT
      } else if (hasIncomingIndex && incomingIndex < bridgeState.selectedIndex) {
        eventType = OsEventTypeList.SCROLL_TOP_EVENT
      } else {
        eventType = OsEventTypeList.CLICK_EVENT
      }
    }

    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      const previousIndex = bridgeState.selectedIndex
      bridgeState.selectedIndex = clampIndex(
        hasIncomingIndex ? incomingIndex : bridgeState.selectedIndex + 1,
        urls.length,
      )
      syncBrowserSelection(bridgeState.selectedIndex)
      await renderBridgePage(bridge, urls, bridgeState.selectedIndex, bridgeState.statusMessage)
      appendEventLog(`REST API glass: down -> ${urls[bridgeState.selectedIndex]}`)
      if (bridgeState.selectedIndex !== previousIndex) {
        const run = bridgeState.onSelectAndRun
        if (run) {
          await run(bridgeState.selectedIndex)
        }
      }
      return
    }

    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      const previousIndex = bridgeState.selectedIndex
      bridgeState.selectedIndex = clampIndex(
        hasIncomingIndex ? incomingIndex : bridgeState.selectedIndex - 1,
        urls.length,
      )
      syncBrowserSelection(bridgeState.selectedIndex)
      await renderBridgePage(bridge, urls, bridgeState.selectedIndex, bridgeState.statusMessage)
      appendEventLog(`REST API glass: up -> ${urls[bridgeState.selectedIndex]}`)
      if (bridgeState.selectedIndex !== previousIndex) {
        const run = bridgeState.onSelectAndRun
        if (run) {
          await run(bridgeState.selectedIndex)
        }
      }
      return
    }

    if (eventType === OsEventTypeList.CLICK_EVENT || (eventType === undefined && event.listEvent)) {
      const selected = hasIncomingIndex ? clampIndex(incomingIndex, urls.length) : bridgeState.selectedIndex
      bridgeState.selectedIndex = selected
      syncBrowserSelection(bridgeState.selectedIndex)
      appendEventLog(`REST API glass: click -> run ${urls[bridgeState.selectedIndex]}`)
      const run = bridgeState.onSelectAndRun
      if (run) {
        await run(bridgeState.selectedIndex)
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
      const urls = getActiveUrls()
      bridgeState.statusMessage = message
      await renderBridgePage(bridgeState.bridge!, urls, bridgeState.selectedIndex, bridgeState.statusMessage)
    },
    async renderList(urls: string[], selectedIndex: number, statusMessage?: string) {
      bridgeState.selectedIndex = clampIndex(selectedIndex, urls.length)
      if (statusMessage) {
        bridgeState.statusMessage = statusMessage
      }
      await renderBridgePage(bridgeState.bridge!, urls, bridgeState.selectedIndex, bridgeState.statusMessage)
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
    bridgeState.statusMessage = 'Select URL and click'
    bridgeDisplay = getMockBridgeDisplay()
    return bridgeDisplay
  }
}

function ensureOption(select: HTMLSelectElement, url: string): void {
  const trimmed = url.trim()
  if (!trimmed) return

  const existing = Array.from(select.options).some((option) => option.value === trimmed)
  if (existing) return

  const option = document.createElement('option')
  option.value = trimmed
  option.textContent = trimmed
  select.append(option)
}

function selectedUrl(select: HTMLSelectElement): string {
  return select.value?.trim() ?? ''
}

function getAllUrls(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((option) => option.value)
}

function ensureUi(): RestUiState {
  const appRoot = document.getElementById('app')
  if (!appRoot) {
    throw new Error('Missing #app root')
  }

  const existing = document.getElementById('restapi-controls') as HTMLDivElement | null
  if (existing) {
    return {
      root: existing,
      select: existing.querySelector('#restapi-url-select') as HTMLSelectElement,
      response: existing.querySelector('#restapi-response') as HTMLPreElement,
      addInput: existing.querySelector('#restapi-url-input') as HTMLInputElement,
      addButton: existing.querySelector('#restapi-url-add') as HTMLButtonElement,
      removeButton: existing.querySelector('#restapi-url-remove') as HTMLButtonElement,
    }
  }

  const controls = document.createElement('div')
  controls.id = 'restapi-controls'
  controls.style.marginTop = '12px'

  const row = document.createElement('div')
  row.style.display = 'flex'
  row.style.gap = '8px'
  row.style.flexWrap = 'wrap'
  row.style.alignItems = 'center'

  const select = document.createElement('select')
  select.id = 'restapi-url-select'
  select.style.minWidth = '320px'

  for (const url of DEFAULT_URLS) {
    ensureOption(select, url)
  }

  const addInput = document.createElement('input')
  addInput.id = 'restapi-url-input'
  addInput.type = 'text'
  addInput.placeholder = 'http://host/rest/path'
  addInput.style.minWidth = '320px'

  const addButton = document.createElement('button')
  addButton.id = 'restapi-url-add'
  addButton.type = 'button'
  addButton.textContent = 'Add URL'

  const removeButton = document.createElement('button')
  removeButton.id = 'restapi-url-remove'
  removeButton.type = 'button'
  removeButton.textContent = 'Remove Selected'

  const response = document.createElement('pre')
  response.id = 'restapi-response'
  response.style.marginTop = '10px'
  response.style.whiteSpace = 'pre-wrap'
  response.style.maxHeight = '320px'
  response.style.overflow = 'auto'
  response.style.border = '1px solid #aaa'
  response.style.padding = '8px'
  response.textContent = 'Response output will appear here.'

  row.append(select, addInput, addButton, removeButton)
  controls.append(row, response)
  appRoot.append(controls)

  return { root: controls, select, response, addInput, addButton, removeButton }
}

async function fetchAsText(url: string): Promise<{ statusLine: string; body: string }> {
  const response = await fetch(`${PROXY_PATH}?url=${encodeURIComponent(url)}`, { method: 'GET' })
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()

  let formatted = text
  if (contentType.includes('application/json')) {
    try {
      formatted = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      formatted = text
    }
  }

  return {
    statusLine: `${response.status} ${response.statusText}`,
    body: formatted,
  }
}

let activeSelectEl: HTMLSelectElement | null = null

function getActiveUrls(): string[] {
  if (!activeSelectEl) {
    return [...DEFAULT_URLS]
  }
  return getAllUrls(activeSelectEl)
}

function syncBrowserSelection(index: number): void {
  if (!activeSelectEl) {
    return
  }

  const urls = getAllUrls(activeSelectEl)
  if (urls.length === 0) {
    return
  }

  const clamped = clampIndex(index, urls.length)
  activeSelectEl.selectedIndex = clamped
  bridgeState.selectedIndex = clamped
}

export function createRestApiActions(setStatus: SetStatus): AppActions {
  let ui: RestUiState | null = null
  let uiInitialized = false
  let isFetching = false

  const runRequestByIndex = async (index: number): Promise<void> => {
    if (!ui) {
      return
    }

    const urls = getAllUrls(ui.select)
    if (urls.length === 0) {
      setStatus('No URL selected')
      appendEventLog('REST API: request blocked (no URL selected)')
      return
    }

    const clamped = clampIndex(index, urls.length)
    ui.select.selectedIndex = clamped
    bridgeState.selectedIndex = clamped

    if (isFetching) {
      setStatus('Request already in progress')
      appendEventLog('REST API: request ignored (already in progress)')
      return
    }

    const url = urls[clamped]
    setStatus(`Fetching ${url} ...`)
    appendEventLog(`REST API: GET ${url}`)

    if (bridgeDisplay) {
      await bridgeDisplay.show('Loading...')
    }

    isFetching = true
    try {
      const { statusLine, body } = await fetchAsText(url)
      const preview = body.length > 200 ? `${body.slice(0, 200)}...` : body

      ui.response.textContent = body
      setStatus(`GET complete: ${statusLine}`)
      appendEventLog(`REST API: ${statusLine}`)
      appendEventLog(`REST API response preview: ${preview.replace(/\n/g, ' ')}`)

      if (bridgeDisplay) {
        const compactPreview = preview.replace(/\s+/g, ' ').slice(0, 96)
        const bridgeMessage = `GET ${statusLine}\n${compactPreview}`
        await bridgeDisplay.show(bridgeMessage)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ui.response.textContent = `Request failed:\n${message}`
      setStatus('GET failed')
      appendEventLog(`REST API: request failed (${message})`)

      if (bridgeDisplay) {
        await bridgeDisplay.show(`GET failed: ${message.slice(0, 80)}`)
      }
    } finally {
      isFetching = false
    }
  }

  function updateBridgeListFromBrowserSelect(target: RestUiState): void {
    if (!bridgeDisplay || bridgeDisplay.mode !== 'bridge') {
      return
    }

    const urls = getAllUrls(target.select)
    const selectedIndex = clampIndex(target.select.selectedIndex, urls.length)
    bridgeState.selectedIndex = selectedIndex
    void bridgeDisplay.renderList(urls, selectedIndex)
  }

  function bindUiEvents(target: RestUiState): void {
    target.select.onchange = () => {
      const urls = getAllUrls(target.select)
      bridgeState.selectedIndex = clampIndex(target.select.selectedIndex, urls.length)
      updateBridgeListFromBrowserSelect(target)
    }

    target.addButton.onclick = () => {
      const inputUrl = target.addInput.value.trim()
      if (!inputUrl) {
        setStatus('Enter a URL before adding')
        return
      }

      ensureOption(target.select, inputUrl)
      target.select.value = inputUrl
      target.addInput.value = ''
      setStatus(`Added URL: ${inputUrl}`)
      appendEventLog(`REST API: added URL ${inputUrl}`)
      updateBridgeListFromBrowserSelect(target)
    }

    target.removeButton.onclick = () => {
      const current = selectedUrl(target.select)
      if (!current) {
        setStatus('No URL selected')
        return
      }

      const selectedIndex = target.select.selectedIndex
      target.select.remove(selectedIndex)

      if (target.select.options.length > 0) {
        target.select.selectedIndex = Math.max(0, selectedIndex - 1)
      }

      setStatus(`Removed URL: ${current}`)
      appendEventLog(`REST API: removed URL ${current}`)
      updateBridgeListFromBrowserSelect(target)
    }
  }

  return {
    async connect() {
      ui = ensureUi()
      activeSelectEl = ui.select

      if (!uiInitialized) {
        bindUiEvents(ui)
        uiInitialized = true
      }

      bridgeDisplay = await initBridgeDisplay()
      bridgeDisplay.onSelectAndRun(runRequestByIndex)

      const urls = getAllUrls(ui.select)
      bridgeState.selectedIndex = clampIndex(ui.select.selectedIndex, urls.length)

      if (bridgeDisplay.mode === 'bridge') {
        await bridgeDisplay.renderList(urls, bridgeState.selectedIndex, 'Select URL and click')
        setStatus('REST API ready. Use glasses Up/Down and Click to run URL.')
        appendEventLog('REST API: controls initialized (bridge mode)')
      } else {
        setStatus('REST API controls ready. Bridge not found, browser mode active.')
        appendEventLog('REST API: controls initialized (mock mode)')
      }
    },

    async action() {
      if (!ui) {
        setStatus('Run setup first')
        appendEventLog('REST API: request blocked (setup not run)')
        return
      }

      await runRequestByIndex(ui.select.selectedIndex)
    },
  }
}
