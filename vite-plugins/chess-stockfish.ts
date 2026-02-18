import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { PluginContext } from './types'

const STOCKFISH_BASE_URL = '/stockfish/'

export default function chessStockfish(ctx: PluginContext): Plugin | null {
  const chessDir = ctx.externalApps['chess']
  if (!chessDir) {
    return null
  }

  const stockfishDir = new URL(`file://${resolve(chessDir, 'public/stockfish')}/`)

  return {
    name: 'chess-stockfish',
    async generateBundle() {
      const stockfishFiles = [
        ['stockfish.wasm.js', 'application/javascript'],
        ['stockfish.wasm', 'application/wasm'],
      ] as const

      for (const [filename] of stockfishFiles) {
        try {
          const source = await readFile(new URL(filename, stockfishDir))
          this.emitFile({
            type: 'asset',
            fileName: `stockfish/${filename}`,
            source,
          })
        } catch {
          // Stockfish assets not found; skip.
        }
      }
    },
    configureServer(server) {
      server.middlewares.use(STOCKFISH_BASE_URL, async (req, res, next) => {
        if (req.method !== 'GET') {
          next()
          return
        }

        const reqUrl = req.url ?? '/'
        const stockfishPath = reqUrl.split('?')[0] ?? '/'
        if (stockfishPath.includes('..')) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end('Invalid stockfish asset path')
          return
        }

        const cleanName = stockfishPath.replace(/^\/+/, '')
        try {
          const source = await readFile(new URL(cleanName, stockfishDir))
          const contentType = cleanName.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/javascript; charset=utf-8'
          res.statusCode = 200
          res.setHeader('content-type', contentType)
          res.end(source)
        } catch {
          next()
        }
      })
    },
  }
}
