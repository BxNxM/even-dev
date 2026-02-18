import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { Plugin } from 'vite'
import type { PluginContext } from './types'

export default function appServer(ctx: PluginContext): Plugin | null {
  const selectedApp = process.env.VITE_APP_NAME ?? process.env.APP_NAME ?? ''
  const appDir = ctx.externalApps[selectedApp]
  if (!appDir) return null

  const serverDir = resolve(appDir, 'server')
  if (!existsSync(resolve(serverDir, 'package.json'))) return null

  return {
    name: 'app-server',
    configureServer() {
      console.log(`[app-server] Starting ${selectedApp} server from ${serverDir}`)
      const child = spawn('npx', ['tsx', 'src/index.ts'], {
        cwd: serverDir,
        stdio: 'inherit',
      })
      child.on('error', (err) => {
        console.error(`[app-server] Failed to start: ${err.message}`)
      })
      process.on('exit', () => child.kill())
    },
  }
}
