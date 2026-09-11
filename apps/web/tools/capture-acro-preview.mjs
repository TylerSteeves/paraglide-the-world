import { spawn } from 'node:child_process'
import { writeFile, copyFile } from 'node:fs/promises'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const debugPort = 9235
const gameUrl = 'http://127.0.0.1:5180/'
const artifactDir = '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3'

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

    console.log('Page loaded, waiting for scene...')
    await delay(2200)

    async function evaluate(expr) {
      const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
      return res?.result?.value
    }

    async function takeScreenshot(filename) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      const buffer = Buffer.from(data, 'base64')
      await writeFile(filename, buffer)
      try {
        await copyFile(filename, `${artifactDir}/${filename}`)
      } catch {}
      console.log(`Saved screenshot: ${filename}`)
    }

    // 1. Launch flight from Alpine Peak
    console.log('Clicking Alpine Peak launch...')
    await evaluate(`
      document.getElementById('hud-launch-alpine-btn')?.click();
      window.actionCam.setVantage('pilot-fpv');
      window.actionCam.snap();
    `)
    await delay(1200)

    // Capture Stylized World Preview (Pilot FPV with boots & vista)
    console.log('Capturing Stylized World Preview (Pilot FPV)...')
    await takeScreenshot('preview-sphere-world.png')

    // 2. High-speed dive and Infinite Tumble over canopy
    console.log('Capturing Infinite Tumble over the wing (Front Selfie View)...')
    await evaluate(`
      window.sim.pilot.pendulumPitchDeg = 145.0; // Inverted loop apex over canopy!
      window.sim.pilot.angularVelocityPitch = 240.0;
      window.sim.canopy.airspeedKmh = 98.0;
      window.sim.telemetry.airspeedKmh = 98.0;
      window.sim.telemetry.gForce = 4.4;
      window.sim.telemetry.lineTensionNewtons = 4520;
      window.sim.telemetry.tumbleStreak = 2;
      window.actionCam.setVantage('front-selfie');
      window.actionCam.snap();
    `)
    await delay(600)
    await takeScreenshot('preview-infinite-tumble.png')

    // 3. Dune du Pilat Foot Drag Skimming (Over-The-Shoulder Chase)
    console.log('Capturing Dune Skimming & Foot Drag in Shoulder Chase...')
    await evaluate(`
      window.sim.reset(208, 10, { x: 0, y: 206, z: 2550 });
      window.sim.canopy.velocity.x = 0;
      window.sim.canopy.velocity.y = -0.3;
      window.sim.canopy.velocity.z = 16.5;
      window.sim.canopy.airspeedKmh = 60.0;
      window.sim.telemetry.airspeedKmh = 60.0;
      window.sim.isFootDragging = true;
      window.sim.telemetry.groundClearanceMeters = 0.5;
      window.actionCam.setVantage('shoulder-chase');
      window.actionCam.snap();
    `)
    await delay(600)
    await takeScreenshot('preview-dune-skim.png')

    // 4. Dune Foot Skimming FPV
    console.log('Capturing Dune Foot Drag in Pilot FPV...')
    await evaluate(`
      window.actionCam.setVantage('pilot-fpv');
      window.actionCam.snap();
    `)
    await delay(600)
    await takeScreenshot('preview-dune-fpv.png')

    // 5. 180° Reverse Stance Kiting
    console.log('Capturing 180° Reverse Stance Kiting...')
    await evaluate(`
      window.inputManager.controls.reverseStance = true;
      window.sim.controls.reverseStance = true;
      window.sim.pilot.reverseStanceYawDeg = 180;
      window.sim.telemetry.isReverseStance = true;
      window.actionCam.setVantage('front-selfie');
      window.actionCam.snap();
    `)
    await delay(600)
    await takeScreenshot('preview-reverse-kiting.png')

    ws.close()
  } finally {
    chrome.kill('SIGTERM')
  }
}

main().catch(console.error)
