const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const port = Number(process.env.LANDING_PORT || 8080)
const workspaceDir = process.env.WORKSPACE_DIR || '/workspace/even-dev'
const htmlPath = path.join(__dirname, 'index.html')
const webPort = Number(process.env.PORT || 5173)

const runner = {
  child: null,
  appName: null,
  startedAt: null,
  exitCode: null,
  exitSignal: null,
  logs: [],
}

function send(res, status, headers, body) {
  res.writeHead(status, headers)
  res.end(body)
}

function sendJson(res, status, payload) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(payload))
}

function pushLog(line) {
  const msg = String(line ?? '').replace(/\r/g, '')
  if (!msg) return
  for (const part of msg.split('\n')) {
    if (!part) continue
    runner.logs.push(`${new Date().toISOString()} ${part}`)
  }
  if (runner.logs.length > 400) {
    runner.logs.splice(0, runner.logs.length - 400)
  }
}

function runnerStatus() {
  return {
    running: Boolean(runner.child),
    appName: runner.appName,
    startedAt: runner.startedAt,
    exitCode: runner.exitCode,
    exitSignal: runner.exitSignal,
    webPort,
    logs: runner.logs.slice(-120),
  }
}

function stopRunner() {
  return new Promise((resolve) => {
    if (!runner.child) return resolve({ stopped: false })
    const child = runner.child
    const pid = child.pid
    pushLog(`[runner] stopping pid=${pid}`)
    const killGroup = (signal) => {
      try {
        // Child is spawned detached, so kill the whole process group (start-even.sh + vite).
        process.kill(-pid, signal)
        return true
      } catch {
        try {
          child.kill(signal)
          return true
        } catch {
          return false
        }
      }
    }
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      resolve(result)
    }
    const timeout = setTimeout(() => {
      if (killGroup('SIGKILL')) {
        pushLog(`[runner] sent SIGKILL pid=${pid} (group)`)
      }
      finish({ stopped: true, force: true })
    }, 5000)
    child.once('exit', () => {
      clearTimeout(timeout)
      finish({ stopped: true, force: false })
    })
    if (!killGroup('SIGTERM')) {
      clearTimeout(timeout)
      finish({ stopped: false })
    }
  })
}

function startRunner(appName) {
  return new Promise(async (resolve) => {
    if (!appName) return resolve({ ok: false, error: 'Missing appName' })
    if (runner.child) {
      await stopRunner()
    }
    const scriptPath = path.join(workspaceDir, 'start-even.sh')
    if (!exists(scriptPath)) return resolve({ ok: false, error: 'start-even.sh not found in workspace' })

    const scriptText = fs.readFileSync(scriptPath, 'utf8')
    const supportsWebOnly = scriptText.includes('--web-only')
    const cmd = supportsWebOnly
      ? ['bash', ['./start-even.sh', '--web-only']]
      : ['npx', ['vite', '--host', '0.0.0.0', '--port', String(webPort)]]

    if (supportsWebOnly) {
      pushLog(`[runner] starting app=${appName} via start-even.sh --web-only`)
    } else {
      pushLog('[runner] start-even.sh lacks --web-only; falling back to direct Vite startup')
      pushLog('[runner] tip: rebuild image and restart container to refresh workspace launcher in persistent volume')
    }

    const child = spawn(cmd[0], cmd[1], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        APP_NAME: appName,
        PORT: String(webPort),
        VITE_HOST: '0.0.0.0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })

    runner.child = child
    runner.appName = appName
    runner.startedAt = new Date().toISOString()
    runner.exitCode = null
    runner.exitSignal = null
    runner.logs = []

    child.stdout.on('data', (buf) => pushLog(buf.toString()))
    child.stderr.on('data', (buf) => pushLog(buf.toString()))
    child.on('error', (err) => pushLog(`[runner] process error: ${err.message}`))
    child.on('exit', (code, signal) => {
      pushLog(`[runner] exited code=${code} signal=${signal}`)
      runner.exitCode = code
      runner.exitSignal = signal
      runner.child = null
    })

    resolve({ ok: true, status: runnerStatus() })
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 1024) {
        reject(new Error('Body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function safeJoin(root, relPath) {
  const cleaned = relPath.replace(/^\/+/, '')
  const full = path.resolve(root, cleaned)
  const rootResolved = path.resolve(root)
  if (!(full === rootResolved || full.startsWith(rootResolved + path.sep))) {
    throw new Error('Path escapes root')
  }
  return full
}

function listDirs(dir) {
  if (!exists(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== '_shared')
    .map((d) => d.name)
    .sort()
}

function readAppsJson() {
  const p = path.join(workspaceDir, 'apps.json')
  if (!exists(p)) return {}
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return {}
  }
}

function appRoot(kind, name) {
  if (kind === 'builtin') return path.join(workspaceDir, 'apps', name)
  if (kind === 'external') return path.join(workspaceDir, '.apps-cache', name)
  throw new Error('Invalid kind')
}

function collectFiles(root) {
  const out = []
  const allowExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.md', '.txt', '.yml', '.yaml'])
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage'])

  function walk(dir, depth) {
    if (depth > 5) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full).replaceAll(path.sep, '/')
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue
        walk(full, depth + 1)
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (!allowExt.has(ext)) continue
      out.push(rel)
    }
  }

  walk(root, 0)

  const priority = (f) => {
    if (/^src\/main\.(ts|tsx|js|jsx)$/.test(f)) return 0
    if (f === 'index.html') return 1
    if (/^src\//.test(f)) return 2
    if (f === 'package.json') return 3
    return 9
  }

  out.sort((a, b) => {
    const pa = priority(a)
    const pb = priority(b)
    if (pa !== pb) return pa - pb
    return a.localeCompare(b)
  })
  return out.slice(0, 200)
}

function buildAppsList() {
  const builtins = listDirs(path.join(workspaceDir, 'apps')).map((name) => ({
    kind: 'builtin',
    name,
    key: `builtin:${name}`,
    sourceLabel: `apps/${name}`,
  }))

  const appsJson = readAppsJson()
  const externals = Object.entries(appsJson).map(([name, raw]) => {
    const cachePath = path.join(workspaceDir, '.apps-cache', name)
    const cloned = exists(cachePath)
    return {
      kind: 'external',
      name,
      key: `external:${name}`,
      sourceLabel: cloned ? `.apps-cache/${name}` : String(raw),
      cached: cloned,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  return [...builtins, ...externals]
}

function htmlPage(res) {
  try {
    const html = fs.readFileSync(htmlPath, 'utf8')
    send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, html)
  } catch (err) {
    send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' },
      `<!doctype html><html><body><h1>even-dev Docker Launcher</h1><pre>${String(err.message)}</pre></body></html>`)
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname
  console.log(`[landing] ${req.method || 'GET'} ${pathname}`)

  if (pathname === '/health') {
    return send(res, 200, { 'Content-Type': 'text/plain; charset=utf-8' }, 'ok\n')
  }

  if (pathname === '/api/apps') {
    return sendJson(res, 200, { apps: buildAppsList() })
  }

  if (pathname === '/api/preview-html') {
    return fetch(`http://127.0.0.1:${webPort}/`)
      .then(async (upstream) => {
        const text = await upstream.text()
        sendJson(res, upstream.ok ? 200 : upstream.status, {
          ok: upstream.ok,
          status: upstream.status,
          html: text,
        })
      })
      .catch((err) => sendJson(res, 502, { error: `Preview upstream unavailable: ${String(err.message || err)}` }))
  }

  if (pathname === '/api/run/status') {
    return sendJson(res, 200, runnerStatus())
  }

  if (pathname === '/api/run/start' && req.method === 'POST') {
    return readBody(req)
      .then(async (body) => {
        let parsed = {}
        try { parsed = body ? JSON.parse(body) : {} } catch { return sendJson(res, 400, { error: 'Invalid JSON' }) }
        const appName = String(parsed.appName || '').trim()
        const result = await startRunner(appName)
        if (!result.ok) return sendJson(res, 400, result)
        return sendJson(res, 200, result)
      })
      .catch((err) => sendJson(res, 400, { error: String(err.message || err) }))
  }

  if (pathname === '/api/run/stop' && req.method === 'POST') {
    return stopRunner()
      .then(() => sendJson(res, 200, { ok: true, status: runnerStatus() }))
      .catch((err) => sendJson(res, 500, { error: String(err.message || err) }))
  }

  if (pathname === '/api/files') {
    const kind = url.searchParams.get('kind') || ''
    const name = url.searchParams.get('name') || ''
    if (!kind || !name) return sendJson(res, 400, { error: 'Missing kind or name' })
    try {
      const root = appRoot(kind, name)
      if (!exists(root)) {
        return sendJson(res, 200, { files: [], missing: true })
      }
      return sendJson(res, 200, { files: collectFiles(root) })
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message || err) })
    }
  }

  if (pathname === '/api/file') {
    const kind = url.searchParams.get('kind') || ''
    const name = url.searchParams.get('name') || ''
    const rel = url.searchParams.get('path') || ''
    if (!kind || !name || !rel) return sendJson(res, 400, { error: 'Missing kind, name, or path' })
    try {
      const root = appRoot(kind, name)
      if (!exists(root)) return sendJson(res, 404, { error: 'App directory not available (not cached yet?)' })
      const full = safeJoin(root, rel)
      const stat = fs.statSync(full)
      if (!stat.isFile()) return sendJson(res, 400, { error: 'Not a file' })
      if (stat.size > 1024 * 1024) return sendJson(res, 400, { error: 'File too large to display' })
      const content = fs.readFileSync(full, 'utf8')
      return sendJson(res, 200, { content })
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message || err) })
    }
  }

  if (pathname === '/go/even') {
    res.writeHead(302, { Location: 'http://localhost:5173' })
    return res.end()
  }
  if (pathname === '/go/editor') {
    res.writeHead(302, { Location: 'http://localhost:5174' })
    return res.end()
  }
  if (pathname === '/go/apps') {
    return send(
      res,
      200,
      { 'Content-Type': 'text/html; charset=utf-8' },
      `<html><body style="font-family:sans-serif;padding:20px">
        <h2>Workspace Volume</h2>
        <p>The persistent Docker volume is mounted at <code>/workspace/even-dev</code>.</p>
        <p>Apps live under <code>/workspace/even-dev/apps</code>.</p>
        <p><a href="/">Back</a></p>
      </body></html>`,
    )
  }
  if (pathname === '/app') {
    const name = (url.searchParams.get('name') || '').trim()
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '')
    return send(
      res,
      200,
      { 'Content-Type': 'text/html; charset=utf-8' },
      `<html><body style="font-family:sans-serif;padding:20px">
        <h2>Start app: ${safe || '(enter a name)'}</h2>
        <pre>APP_NAME=${safe || 'my-app'} docker compose up -d even-webui</pre>
        <p><a href="http://localhost:5173">Open main UI</a></p>
        <p><a href="/">Back</a></p>
      </body></html>`,
    )
  }

  return htmlPage(res)
}).listen(port, '0.0.0.0', () => {
  console.log(`[webui-docker] Landing page listening on http://0.0.0.0:${port}`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[landing] ${sig} received, shutting down`)
    try { await stopRunner() } catch {}
    process.exit(0)
  })
}
