// vite.config.ts
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Alias, Plugin } from 'vite'
import { loadAppPlugins } from './vite-plugins'

// ---------------------------------------------------------------------------
// External app registry (apps.json + APP_PATH env override)
// ---------------------------------------------------------------------------

const APPS_CACHE_DIR = resolve('.apps-cache')

function isGitUrl(value: string): boolean {
  const base = value.split('#')[0] ?? ''
  return base.startsWith('https://') || base.startsWith('git@')
}

function resolveGitEntry(name: string, value: string): string {
  const [, subpath] = value.split('#')
  const base = resolve(APPS_CACHE_DIR, name)
  return subpath ? resolve(base, subpath) : base
}

function loadExternalApps(): Record<string, string> {
  const apps: Record<string, string> = {}

  if (existsSync('apps.json')) {
    const raw = JSON.parse(readFileSync('apps.json', 'utf8')) as Record<string, string>
    for (const [name, value] of Object.entries(raw)) {
      apps[name] = isGitUrl(value) ? resolveGitEntry(name, value) : resolve(value)
    }
  }

  const appName = process.env.APP_NAME ?? process.env.VITE_APP_NAME ?? ''
  const appPath = process.env.APP_PATH ?? ''
  if (appName && appPath) {
    apps[appName] = resolve(appPath)
  }

  return apps
}

const externalApps = loadExternalApps()

// ---------------------------------------------------------------------------
// External app HTML plugin: serve the external app's own index.html
// ---------------------------------------------------------------------------

function externalAppHtmlPlugin(): Plugin | null {
  const selectedApp = process.env.VITE_APP_NAME ?? process.env.APP_NAME ?? ''
  const appDir = externalApps[selectedApp]
  if (!appDir) return null

  const absAppDir = resolve(appDir)
  const htmlPath = resolve(absAppDir, 'index.html')
  if (!existsSync(htmlPath)) return null

  return {
    name: 'external-app-html',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (url !== '/' && url !== '/index.html') {
          next()
          return
        }

        try {
          let html = readFileSync(htmlPath, 'utf-8')
          // Rewrite local absolute paths to /@fs/ so Vite resolves them
          // from the external app's directory instead of even-dev's root
          html = html.replace(
            /(src|href)=(["'])\/(?!\/|@|http)/g,
            `$1=$2/@fs/${absAppDir}/`,
          )
          html = await server.transformIndexHtml(url, html)
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        } catch (e) {
          next(e)
        }
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Vite aliases + fs.allow from external apps
// ---------------------------------------------------------------------------

function buildAliases(): Alias[] {
  return Object.entries(externalApps).map(([name, absPath]) => ({
    find: `apps/${name}`,
    replacement: absPath,
  }))
}

function buildFsAllow(): string[] {
  const dirs = new Set<string>()
  for (const absPath of Object.values(externalApps)) {
    dirs.add(absPath)
    dirs.add(resolve(absPath, '..'))
  }
  return [...dirs]
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export default defineConfig({
  plugins: [
    externalAppHtmlPlugin(),
    ...loadAppPlugins({ externalApps }),
  ].filter(Boolean),
  resolve: {
    alias: buildAliases(),
  },
  server: {
    host: true,
    port: 5173,
    fs: {
      allow: ['.', ...buildFsAllow()],
    },
  },
})
