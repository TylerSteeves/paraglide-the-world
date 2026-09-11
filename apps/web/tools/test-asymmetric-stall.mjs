import { spawn } from 'node:child_process'
import { writeFile, copyFile } from 'node:fs/promises'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const debugPort = 9229
const gameUrl = 'http://127.0.0.1:5180/'

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--hide-scrollbars',
      '--enable-gpu',
      '--use-angle=metal',
      '--no-first-run',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=1280,720',
      `--remote-debugging-port=${debugPort}`,
      gameUrl,
    ],
    { stdio: 'ignore' },
  )

  try {
    let page = null
    for (let i = 0; i < 40; i++) {
      try {
        const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json())
        page = pages.find((p) => p.type === 'page')
        if (page) break
      } catch {}
      await delay(150)
    }

    if (!page) throw new Error('Could not find page in Chrome debugging session')

    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve) => (ws.onopen = resolve))

    let id = 1
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const msgId = id++
        const handler = (event) => {
          const data = JSON.parse(event.data)
          if (data.id === msgId) {
            ws.removeEventListener('message', handler)
            resolve(data.result)
          }
        }
        ws.addEventListener('message', handler)
        ws.send(JSON.stringify({ id: msgId, method, params }))
      })
    }

    await send('Page.enable')
    await send('Runtime.enable')

    await delay(2500)

    // Launch
    await send('Runtime.evaluate', {
      expression: `document.getElementById('btn-launch')?.click();`,
    })
    console.log('Flight launched!')
    await delay(2000)

    // 1. Moderate Left Turn (Tap/hold KeyA for 0.6s)
    await send('Runtime.evaluate', {
      expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }));`,
    })
    await delay(600)

    const carveShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('carve-turn.png', Buffer.from(carveShot.data, 'base64'))
    await copyFile('carve-turn.png', '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3/carve-turn.png')
    console.log('Captured carve-turn.png (clean coordinated carving bank, wing leads)!')

    // 2. Keep holding KeyA for deep asymmetric stall (1.8s additional)
    await delay(1800)

    const stallShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('asymmetric-stall.png', Buffer.from(stallShot.data, 'base64'))
    await copyFile('asymmetric-stall.png', '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3/asymmetric-stall.png')
    console.log('Captured asymmetric-stall.png (left wing collapsed, negative flat spin plummet)!')

    // Read telemetry from browser
    const telemetryStatus = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const alt = document.getElementById('hud-alt')?.innerText;
          const vario = document.getElementById('hud-vario')?.innerText;
          const tension = document.getElementById('hud-tension')?.innerText;
          const banner = document.getElementById('hud-trick-banner')?.innerText;
          return { alt, vario, tension, banner };
        })()
      `,
      returnByValue: true,
    })
    console.log('Telemetry in Asymmetric Stall:', telemetryStatus.result?.value)

    // 3. Release KeyA and recover
    await send('Runtime.evaluate', {
      expression: `window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', bubbles: true }));`,
    })
    await delay(2200)

    const recoveryShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('stall-recovery.png', Buffer.from(recoveryShot.data, 'base64'))
    await copyFile('stall-recovery.png', '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3/stall-recovery.png')
    console.log('Captured stall-recovery.png (re-inflation and recovery glide)!')

    const recoveredTelemetry = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const alt = document.getElementById('hud-alt')?.innerText;
          const vario = document.getElementById('hud-vario')?.innerText;
          const tension = document.getElementById('hud-tension')?.innerText;
          return { alt, vario, tension };
        })()
      `,
      returnByValue: true,
    })
    console.log('Telemetry after recovery:', recoveredTelemetry.result?.value)

    ws.close()
  } finally {
    chrome.kill()
  }
}

main().catch(console.error)
