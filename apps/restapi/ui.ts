import { browserOptionLabel, TAG_ALL, type RestCommand } from './model'

export type RestUiState = {
  root: HTMLDivElement
  select: HTMLSelectElement
  response: HTMLPreElement
  urlInput: HTMLInputElement
  nameInput: HTMLInputElement
  tagsInput: HTMLInputElement
  addButton: HTMLButtonElement
  removeButton: HTMLButtonElement
  tagFilterSelect: HTMLSelectElement
}

export function ensureUi(): RestUiState {
  const appRoot = document.getElementById('app')
  if (!appRoot) {
    throw new Error('Missing #app root')
  }

  const existing = document.getElementById('restapi-controls') as HTMLDivElement | null
  if (existing) {
    return {
      root: existing,
      select: existing.querySelector('#restapi-command-select') as HTMLSelectElement,
      response: existing.querySelector('#restapi-response') as HTMLPreElement,
      urlInput: existing.querySelector('#restapi-url-input') as HTMLInputElement,
      nameInput: existing.querySelector('#restapi-name-input') as HTMLInputElement,
      tagsInput: existing.querySelector('#restapi-tags-input') as HTMLInputElement,
      addButton: existing.querySelector('#restapi-command-add') as HTMLButtonElement,
      removeButton: existing.querySelector('#restapi-command-remove') as HTMLButtonElement,
      tagFilterSelect: existing.querySelector('#restapi-tag-filter') as HTMLSelectElement,
    }
  }

  const controls = document.createElement('div')
  controls.id = 'restapi-controls'
  controls.style.marginTop = '12px'

  const commandRow = document.createElement('div')
  commandRow.style.display = 'flex'
  commandRow.style.gap = '8px'
  commandRow.style.flexWrap = 'wrap'
  commandRow.style.alignItems = 'center'

  const select = document.createElement('select')
  select.id = 'restapi-command-select'
  select.style.minWidth = '360px'

  const removeButton = document.createElement('button')
  removeButton.id = 'restapi-command-remove'
  removeButton.type = 'button'
  removeButton.textContent = 'Remove Selected'

  const filterRow = document.createElement('div')
  filterRow.style.display = 'flex'
  filterRow.style.gap = '8px'
  filterRow.style.flexWrap = 'wrap'
  filterRow.style.alignItems = 'center'
  filterRow.style.marginTop = '8px'

  const tagFilterLabel = document.createElement('span')
  tagFilterLabel.textContent = 'Glasses tag filter:'

  const tagFilterSelect = document.createElement('select')
  tagFilterSelect.id = 'restapi-tag-filter'
  tagFilterSelect.style.minWidth = '200px'

  const inputRow = document.createElement('div')
  inputRow.style.display = 'flex'
  inputRow.style.gap = '8px'
  inputRow.style.flexWrap = 'wrap'
  inputRow.style.alignItems = 'center'
  inputRow.style.marginTop = '8px'

  const urlInput = document.createElement('input')
  urlInput.id = 'restapi-url-input'
  urlInput.type = 'text'
  urlInput.placeholder = 'URL (required)'
  urlInput.style.minWidth = '320px'

  const nameInput = document.createElement('input')
  nameInput.id = 'restapi-name-input'
  nameInput.type = 'text'
  nameInput.placeholder = 'Name (optional, recommended)'
  nameInput.style.minWidth = '220px'

  const tagsInput = document.createElement('input')
  tagsInput.id = 'restapi-tags-input'
  tagsInput.type = 'text'
  tagsInput.placeholder = 'Tags (optional, comma-separated)'
  tagsInput.style.minWidth = '220px'

  const addButton = document.createElement('button')
  addButton.id = 'restapi-command-add'
  addButton.type = 'button'
  addButton.textContent = 'Add Command'

  const response = document.createElement('pre')
  response.id = 'restapi-response'
  response.style.marginTop = '10px'
  response.style.whiteSpace = 'pre-wrap'
  response.style.maxHeight = '320px'
  response.style.overflow = 'auto'
  response.style.border = '1px solid #aaa'
  response.style.padding = '8px'
  response.textContent = 'Response output will appear here.'

  commandRow.append(select, removeButton)
  filterRow.append(tagFilterLabel, tagFilterSelect)
  inputRow.append(urlInput, nameInput, tagsInput, addButton)
  controls.append(commandRow, filterRow, inputRow, response)
  appRoot.append(controls)

  return {
    root: controls,
    select,
    response,
    urlInput,
    nameInput,
    tagsInput,
    addButton,
    removeButton,
    tagFilterSelect,
  }
}

export function getSelectedCommandId(select: HTMLSelectElement): number | null {
  const parsed = Number.parseInt(select.value, 10)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return parsed
}

export function readCommandInput(ui: RestUiState): { url: string; name: string; tagsInput: string } {
  return {
    url: ui.urlInput.value.trim(),
    name: ui.nameInput.value.trim(),
    tagsInput: ui.tagsInput.value,
  }
}

export function clearCommandInput(ui: RestUiState): void {
  ui.urlInput.value = ''
  ui.nameInput.value = ''
  ui.tagsInput.value = ''
}

export function rebuildCommandSelect(
  select: HTMLSelectElement,
  commands: RestCommand[],
  selectedCommandId?: number,
): void {
  const currentId = selectedCommandId ?? getSelectedCommandId(select)
  select.innerHTML = ''

  for (const command of commands) {
    const option = document.createElement('option')
    option.value = String(command.id)
    option.textContent = browserOptionLabel(command)
    select.append(option)
  }

  if (select.options.length === 0) {
    return
  }

  const index = currentId ? commands.findIndex((command) => command.id === currentId) : 0
  select.selectedIndex = index >= 0 ? index : 0
}

export function rebuildTagFilterSelect(
  select: HTMLSelectElement,
  tags: string[],
  activeTag: string,
): void {
  select.innerHTML = ''

  const allOption = document.createElement('option')
  allOption.value = TAG_ALL
  allOption.textContent = 'All tags'
  select.append(allOption)

  for (const tag of tags) {
    const option = document.createElement('option')
    option.value = tag
    option.textContent = `#${tag}`
    select.append(option)
  }

  const exists = Array.from(select.options).some((option) => option.value === activeTag)
  select.value = exists ? activeTag : TAG_ALL
}

export function syncSelectByCommandId(select: HTMLSelectElement, commandId: number): void {
  const idx = Array.from(select.options).findIndex((option) => Number.parseInt(option.value, 10) === commandId)
  if (idx >= 0) {
    select.selectedIndex = idx
  }
}

export function syncTagFilter(select: HTMLSelectElement, tagFilter: string): void {
  const exists = Array.from(select.options).some((option) => option.value === tagFilter)
  select.value = exists ? tagFilter : TAG_ALL
}
