import { execFile } from 'node:child_process'
import type { Plugin } from 'vite'

function openExternalUrl(target: string): Promise<void> {
  const openCommand = process.platform === 'darwin'
    ? ['open', target]
    : process.platform === 'win32'
      ? ['cmd', '/c', 'start', '', target]
      : ['xdg-open', target]

  return new Promise<void>((resolve, reject) => {
    execFile(openCommand[0], openCommand.slice(1), (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function isEditorUrlReachable(target: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 900)
    const response = await fetch(target, { method: 'GET', signal: controller.signal })
    clearTimeout(timer)

    if (!response.ok) {
      return false
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) {
      return false
    }

    const body = await response.text()
    return body.includes('Smart Glasses UI Builder')
  } catch {
    return false
  }
}

export default function browserLauncher(): Plugin {
  return {
    name: 'browser-launcher',
    configureServer(server) {
      server.middlewares.use('/__open_editor', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end('Method Not Allowed')
          return
        }

        try {
          const explicitUrl = new URL(req.url ?? '', 'http://localhost').searchParams.get('url')?.trim() ?? ''
          const candidates = [
            explicitUrl,
            'http://localhost:5174/even-ui-builder/',
            'http://127.0.0.1:5174/even-ui-builder/',
            'http://localhost:5173/even-ui-builder/',
            'http://127.0.0.1:5173/even-ui-builder/',
          ].filter(Boolean)

          let openedUrl: string | null = null
          for (const candidate of candidates) {
            if (await isEditorUrlReachable(candidate)) {
              await openExternalUrl(candidate)
              openedUrl = candidate
              break
            }
          }

          if (!openedUrl) {
            res.statusCode = 404
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: 'Editor dev server not reachable.' }))
            return
          }

          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true, url: openedUrl }))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          const message = error instanceof Error ? error.message : String(error)
          res.end(`Failed to open editor URL: ${message}`)
        }
      })

      server.middlewares.use('/__open_external', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end('Method Not Allowed')
          return
        }

        try {
          const parsed = new URL(req.url ?? '', 'http://localhost')
          const target = parsed.searchParams.get('url')?.trim() ?? ''
          if (!target || (!target.startsWith('http://') && !target.startsWith('https://'))) {
            res.statusCode = 400
            res.setHeader('content-type', 'text/plain; charset=utf-8')
            res.end('Missing or invalid "url" query parameter')
            return
          }

          await openExternalUrl(target)

          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true }))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          const message = error instanceof Error ? error.message : String(error)
          res.end(`Failed to open external URL: ${message}`)
        }
      })
    },
  }
}
