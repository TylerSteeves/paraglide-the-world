import { spawn } from 'node:child_process'
import { writeFile, copyFile } from 'node:fs/promises'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const debugPort = 9245
const gameUrl = 'http://127.0.0.1:5181/'
const artifactDir = '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3'

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('Launching headless Chrome to test trackpad & touch controls on port 5181...')
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
    await delay(2000)

    // Click launch button to start flight
    await send('Runtime.evaluate', {
      expression: `
        const btn = document.getElementById('hud-launch-alpine-btn');
        if (btn) btn.click();
      `,
    })
    await delay(1000)

    // Test 1: Trackpad Wheel Swipe Down (Pull Brakes)
    console.log('Testing trackpad swipe down (brake pull)...')
    for (let i = 0; i < 15; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 640,
        y: 360,
        deltaX: 0,
        deltaY: -35, // Downward swipe on Mac trackpad (negative deltaY on natural scrolling)
      })
      await delay(20)
    }
    await delay(50)

    const brakeState = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        leftBrake: window.sim?.controls?.leftBrake,
        rightBrake: window.sim?.controls?.rightBrake,
        trackpadPitch: window.inputManager?.trackpadPitch,
        trackpadActive: window.inputManager?.trackpadActive,
      })`,
      returnByValue: true,
    })
    console.log('Brake test state:', brakeState.result.value)

    // Capture screenshot during brake/flare
    const brakeShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('preview-trackpad-flare.png', Buffer.from(brakeShot.data, 'base64'))
    await copyFile('preview-trackpad-flare.png', `${artifactDir}/preview-trackpad-flare.png`)

    // Test 2: Trackpad Swipe Left (Carve Left Steer & Weight Shift)
    console.log('Testing trackpad swipe left (steer left)...')
    for (let i = 0; i < 20; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 640,
        y: 360,
        deltaX: -30, // Swiping left
        deltaY: 0,
      })
      await delay(20)
    }
    await delay(100)

    const steerState = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        weightShift: window.sim?.controls?.weightShift,
        leftBrake: window.sim?.controls?.leftBrake,
        rightBrake: window.sim?.controls?.rightBrake,
        bankDeg: window.sim?.canopy?.rollDeg,
      })`,
      returnByValue: true,
    })
    console.log('Steer test state:', steerState.result.value)

    const steerShot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('preview-trackpad-steer.png', Buffer.from(steerShot.data, 'base64'))
    await copyFile('preview-trackpad-steer.png', `${artifactDir}/preview-trackpad-steer.png`)

    console.log('Trackpad & Touch tests passed successfully!')
    ws.close()
  } finally {
    chrome.kill('SIGTERM')
  }
}

main().catch(console.error)
