import type { Plugin } from 'vite'
import type { PluginContext } from './types'
import appServer from './app-server'
import browserLauncher from './browser-launcher'
import chessStockfish from './chess-stockfish'
import redditProxy from './reddit-proxy'
import restapiProxy from './restapi-proxy'

export function loadAppPlugins(ctx: PluginContext): Plugin[] {
  return [
    appServer(ctx),
    browserLauncher(),
    chessStockfish(ctx),
    redditProxy(),
    restapiProxy(),
  ].filter((p): p is Plugin => p !== null)
}
