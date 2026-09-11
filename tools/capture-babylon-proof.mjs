import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const gameUrl = process.env.PARAGLIDE_CAPTURE_URL ?? 'http://[::1]:5173/'
const chromePath =
  process.env.CHROME_BIN ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const frameRate = 12
const durationSeconds = 18
const frameCount = frameRate * durationSeconds
const debugPort = 9224
const projectRoot = resolve(import.meta.dirname, '..')
const artifactDir = join(projectRoot, 'artifacts')
const captureDir = await mkdtemp(join(tmpdir(), 'paraglide-proof-'))
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const outputPath = join(artifactDir, `paraglide-godogen-proof-${timestamp}.mp4`)

await mkdir(artifactDir, { recursive: true })

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--hide-scrollbars',
    '--enable-gpu',
    '--use-angle=metal',
    '--no-first-run',
    '--disable-background-networking',
    `--user-data-dir=${join(captureDir, 'chrome-profile')}`,
    '--window-size=1440,900',
    `--remote-debugging-port=${debugPort}`,
    gameUrl,
  ],
  { stdio: 'ignore' },
)

let socket
const runtimeIssues = []

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function getGamePage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(
        (response) => response.json(),
      )
      const page = pages.find(
        (candidate) => candidate.type === 'page' && candidate.url.includes('5173'),
      )
      if (page) return page
    } catch {
      // Chrome is still starting.
    }
    await delay(125)
  }
  throw new Error(`Chrome did not open ${gameUrl}`)
}

try {
  const page = await getGamePage()
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })

  let requestId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
      return
    }

    if (message.method === 'Runtime.exceptionThrown') {
      runtimeIssues.push(message.params.exceptionDetails.text)
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      runtimeIssues.push(message.params.entry.text)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolveRequest, rejectRequest) => {
      const id = ++requestId
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return result.result.value
  }
  const setKey = (type, key, code, virtualKeyCode) =>
    send('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    })

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate('window.__PARAGLIDE_READY__ === true')) break
    await delay(100)
  }

  const captureStartedAt = performance.now()
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    if (frameIndex === frameRate * 3) {
      await setKey('keyDown', 'a', 'KeyA', 65)
      await setKey('keyDown', 'f', 'KeyF', 70)
    }
    if (frameIndex === frameRate * 7) {
      await setKey('keyUp', 'a', 'KeyA', 65)
      await setKey('keyUp', 'f', 'KeyF', 70)
    }
    if (frameIndex === frameRate * 9) {
      await setKey('keyDown', ';', 'Semicolon', 186)
      await setKey('keyDown', 'j', 'KeyJ', 74)
    }
    if (frameIndex === frameRate * 13) {
      await setKey('keyUp', ';', 'Semicolon', 186)
      await setKey('keyUp', 'j', 'KeyJ', 74)
      await setKey('keyDown', ' ', 'Space', 32)
    }
    if (frameIndex === frameRate * 16) {
      await setKey('keyUp', ' ', 'Space', 32)
    }

    const screenshot = await send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 88,
      fromSurface: true,
    })
    await writeFile(
      join(captureDir, `frame_${String(frameIndex + 1).padStart(4, '0')}.jpg`),
      Buffer.from(screenshot.data, 'base64'),
    )

    const nextFrameAt = captureStartedAt + ((frameIndex + 1) * 1000) / frameRate
    await delay(Math.max(0, nextFrameAt - performance.now()))
  }

  const proofState = await evaluate(`({
    ready: window.__PARAGLIDE_READY__,
    renderer: window.__PARAGLIDE_RENDERER__,
    status: document.querySelector('.sim-status strong')?.textContent,
    mode: document.querySelector('.sim-shell')?.className,
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight
  })`)

  const encode = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-framerate',
      String(frameRate),
      '-i',
      join(captureDir, 'frame_%04d.jpg'),
      '-vf',
      'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { encoding: 'utf8' },
  )
  if (encode.status !== 0) {
    throw new Error(encode.stderr || 'ffmpeg could not encode the proof video')
  }

  process.stdout.write(
    `${JSON.stringify({ outputPath, durationSeconds, frameRate, proofState, runtimeIssues }, null, 2)}\n`,
  )
} finally {
  socket?.close()
  chrome.kill('SIGTERM')
  await Promise.race([once(chrome, 'exit'), delay(1_500)])
  if (chrome.exitCode == null) {
    chrome.kill('SIGKILL')
  }
}
