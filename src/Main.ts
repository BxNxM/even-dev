import type { AppModule } from '../apps/_shared/app-types'

type AppModuleShape = {
  app?: AppModule
  default?: AppModule
}

const builtinModules = import.meta.glob('../apps/*/index.ts')

function builtinAppNames(): string[] {
  return Object.keys(builtinModules)
    .map(p => p.match(/\.\.\/apps\/([^/]+)\/index\.ts$/)?.[1] ?? '')
    .filter(Boolean)
}

async function loadApp(name: string): Promise<AppModuleShape | null> {
  const builtinPath = `../apps/${name}/index.ts`
  const builtinImporter = builtinModules[builtinPath]

  if (builtinImporter) {
    return (await builtinImporter()) as AppModuleShape
  }

  return null
}

function resolveSelectedApp(appNames: string[]): string {
  const envApp = String(import.meta.env.VITE_APP_NAME ?? '')

  if (envApp && appNames.includes(envApp)) {
    return envApp
  }

  if (appNames.includes('demo')) {
    return 'demo'
  }

  return appNames[0] ?? ''
}

function updateStatus(text: string) {
  console.log(`[ui] ${text}`)
  const el = document.getElementById('status')
  if (el) {
    el.textContent = text
  }
}

async function boot() {
  const appNames = builtinAppNames()

  if (appNames.length === 0) {
    updateStatus('No apps found in /apps')
    throw new Error('No app modules found. Add apps/<name>/index.ts')
  }

  const selectedAppName = resolveSelectedApp(appNames)
  const module = await loadApp(selectedAppName)

  if (!module) {
    updateStatus(`App not found: ${selectedAppName}`)
    throw new Error(`Missing app module: ${selectedAppName}`)
  }

  const loadedApp = module.app ?? module.default

  if (!loadedApp || typeof loadedApp.createActions !== 'function') {
    updateStatus(`Invalid app module: ${selectedAppName}`)
    throw new Error(`App module ${selectedAppName} must export 'app' or default with createActions()`)
  }

  const heading = document.querySelector('#app h1')
  const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement | null
  const actionBtn = document.getElementById('actionBtn') as HTMLButtonElement | null

  if (heading) {
    heading.textContent = loadedApp.pageTitle ?? `Even Hub ${loadedApp.name} App`
  }

  if (connectBtn) {
    connectBtn.textContent = loadedApp.connectLabel ?? `Connect ${loadedApp.name}`
  }

  if (actionBtn) {
    actionBtn.textContent = loadedApp.actionLabel ?? `${loadedApp.name} Action`
  }

  document.title = `Even Demo - ${loadedApp.name}`
  console.log('[app-loader] Selected app', {
    selectedAppName,
    appNames,
  })

  updateStatus(loadedApp.initialStatus ?? `${loadedApp.name} app ready`)
  const actions = await loadedApp.createActions(updateStatus)
  let isConnecting = false
  let isRunningAction = false

  connectBtn?.addEventListener('click', async () => {
    if (isConnecting) {
      return
    }

    isConnecting = true
    if (connectBtn) {
      connectBtn.disabled = true
    }

    try {
      await actions.connect()
    } catch (error) {
      console.error('[app-loader] connect action failed', error)
      updateStatus('Connect action failed')
    } finally {
      isConnecting = false
      if (connectBtn) {
        connectBtn.disabled = false
      }
    }
  })

  actionBtn?.addEventListener('click', async () => {
    if (isRunningAction) {
      return
    }

    isRunningAction = true
    if (actionBtn) {
      actionBtn.disabled = true
    }

    try {
      await actions.action()
    } catch (error) {
      console.error('[app-loader] secondary action failed', error)
      updateStatus('Action failed')
    } finally {
      isRunningAction = false
      if (actionBtn) {
        actionBtn.disabled = false
      }
    }
  })
}

void boot().catch((error) => {
  console.error('[app-loader] boot failed', error)
  updateStatus('App boot failed')
})
