import { spawn } from 'node:child_process'
import { writeFile, copyFile } from 'node:fs/promises'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const debugPort = 9228
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

    if (!page) {
      throw new Error('Could not find page in Chrome debugging session')
    }

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

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('[Browser]', ...msg.params.args.map((a) => a.value || a.description))
      }
    })

    // Wait for Babylon scene to initialize
    await delay(2500)

    // Click launch button
    const launchResult = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = document.getElementById('btn-launch');
          if (btn) {
            btn.click();
            return 'Clicked launch';
          }
          return 'Launch button not found';
        })()
      `,
    })
    console.log('Launch click result:', launchResult.result?.value)

    // Fly in fast trim for 3.0s down the Whistler bowl
    await delay(3000)

    // Capture high-speed trim flight: Hands high, harness-anchored action cam, full 36-line cascade
    const trimShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('flight-screenshot.png', Buffer.from(trimShot.data, 'base64'))
    await copyFile('flight-screenshot.png', '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3/flight-screenshot.png')
    console.log('Successfully captured flight-screenshot.png (high speed trim flight)!')

    // Push Speed Bar (Space key) to accelerate forward into high-speed dive (>75 km/h)
    console.log('Pushing Speed Bar (Space key) for high-speed alpine dive...')
    await send('Runtime.evaluate', {
      expression: `
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
      `,
    })
    await delay(1800)

    const speedbarShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('speedbar-screenshot.png', Buffer.from(speedbarShot.data, 'base64'))
    await copyFile('speedbar-screenshot.png', '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3/speedbar-screenshot.png')
    console.log('Successfully captured speedbar-screenshot.png (high-speed alpine dive on speed bar)!')

    const speedbarTelemetry = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const alt = document.getElementById('hud-alt')?.innerText;
          const vario = document.getElementById('hud-vario')?.innerText;
          const speed = document.getElementById('hud-speed')?.innerText;
          const tension = document.getElementById('hud-tension')?.innerText;
          return { alt, vario, speed, tension };
        })()
      `,
      returnByValue: true,
    })
    console.log('Telemetry during Speed Bar Dive:', speedbarTelemetry.result?.value)

    // Release Speed Bar key
    await send('Runtime.evaluate', {
      expression: `
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
      `,
    })
    await delay(1500)

    // Switch back to Action-Cam Fisheye lens, and switch vantage to Helmet FPV
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const lensBtn = document.getElementById('btn-lens');
          if (lensBtn) lensBtn.click(); // cycles back to Action-Cam
          const vantageBtn = document.getElementById('btn-vantage');
          if (vantageBtn) vantageBtn.click(); // cycles to Helmet FPV
        })()
      `,
    })
    await delay(1200)
    const fpvShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('helmet-screenshot.png', Buffer.from(fpvShot.data, 'base64'))
    await copyFile('helmet-screenshot.png', '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3/helmet-screenshot.png')
    console.log('Successfully captured helmet-screenshot.png (First-person Helmet FPV vantage)!')

    // Switch vantage to Wide Chase Cam
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const vantageBtn = document.getElementById('btn-vantage');
          if (vantageBtn) vantageBtn.click(); // cycles to Wide Chase
        })()
      `,
    })
    await delay(1200)
    const chaseShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('chase-screenshot.png', Buffer.from(chaseShot.data, 'base64'))
    await copyFile('chase-screenshot.png', '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3/chase-screenshot.png')
    console.log('Successfully captured chase-screenshot.png (Wide Chase Cam vantage)!')

    // Switch vantage back to Selfie Pole
    await send('Runtime.evaluate', {
      expression: `document.getElementById('btn-vantage')?.click();`,
    })
    await delay(800)

    // Test 1: Coordinated Carving Turn (Tap / Hold KeyA for 0.8s)
    console.log('Initiating coordinated carving left turn with KeyA...')
    await send('Runtime.evaluate', {
      expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }));`,
    })
    await delay(1200)
    const carveShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('carve-turn.png', Buffer.from(carveShot.data, 'base64'))
    await copyFile('carve-turn.png', '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3/carve-turn.png')
    console.log('Successfully captured carve-turn.png (clean coordinated bank, wing leads)!')

    await send('Runtime.evaluate', {
      expression: `window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', bubbles: true }));`,
    })
    await delay(600)

    // Test 2: Deliberate Asymmetric Stall & Negative Flat Spin Plummet via KeyF (Left Deep Brake)
    console.log('Burying left brake with KeyF for deliberate Asymmetric Stall & Spin...')
    await send('Runtime.evaluate', {
      expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));`,
    })
    await delay(1500)
    const stallShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('asymmetric-stall.png', Buffer.from(stallShot.data, 'base64'))
    await copyFile('asymmetric-stall.png', '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3/asymmetric-stall.png')
    console.log('Successfully captured asymmetric-stall.png (left wing collapsed, negative flat spin plummet)!')

    // Read HUD telemetry in Asymmetric Stall
    const stallTelemetry = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const alt = document.getElementById('hud-alt')?.innerText;
          const vario = document.getElementById('hud-vario')?.innerText;
          const speed = document.getElementById('hud-speed')?.innerText;
          const tension = document.getElementById('hud-tension')?.innerText;
          const banner = document.getElementById('hud-trick-banner')?.innerText;
          return { alt, vario, speed, tension, banner };
        })()
      `,
      returnByValue: true,
    })
    console.log('Telemetry during Asymmetric Stall:', stallTelemetry.result?.value)

    // Test 3: Release KeyF and observe recovery dive & re-inflation
    console.log('Releasing KeyF for recovery dive...')
    await send('Runtime.evaluate', {
      expression: `window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', bubbles: true }));`,
    })
    await delay(2200)
    const recoveryShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('stall-recovery.png', Buffer.from(recoveryShot.data, 'base64'))
    await copyFile('stall-recovery.png', '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3/stall-recovery.png')
    console.log('Successfully captured stall-recovery.png (re-inflated wing and recovery glide)!')

    const recoveryTelemetry = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const alt = document.getElementById('hud-alt')?.innerText;
          const vario = document.getElementById('hud-vario')?.innerText;
          const speed = document.getElementById('hud-speed')?.innerText;
          const tension = document.getElementById('hud-tension')?.innerText;
          return { alt, vario, speed, tension };
        })()
      `,
      returnByValue: true,
    })
    console.log('Telemetry after Recovery:', recoveryTelemetry.result?.value)

    ws.close()
  } finally {
    chrome.kill()
  }
}

main().catch(console.error)
