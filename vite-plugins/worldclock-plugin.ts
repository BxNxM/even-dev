import type { Plugin } from 'vite'
import type { PluginContext } from './types'

export default function worldclockPlugin(ctx: PluginContext): Plugin | null {
  if (ctx.selectedApp !== 'worldclock' || !ctx.selectedAppDir) {
    return null
  }

  return {
    name: 'worldclock-jsx-runtime',
    config() {
      return {
        esbuild: {
          jsx: 'automatic',
          jsxImportSource: 'react',
        },
      }
    },
  }
}
