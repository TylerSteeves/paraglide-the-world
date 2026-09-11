import { spawn } from 'node:child_process'

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
      '--remote-debugging-port=' + debugPort,
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

    await delay(2000)

    // Launch
    await send('Runtime.evaluate', {
      expression: `document.getElementById('btn-launch')?.click();`,
    })
    await delay(1000)

    // Monitor for 5 seconds while pressing KeyA
    console.log('Testing KeyA press...')
    await send('Runtime.evaluate', {
      expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }));`,
    })

    for (let t = 0; t <= 3000; t += 500) {
      await delay(500)
      const data = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const s = window.sim;
            return {
              timeMs: ${t + 500},
              canopyRoll: s.canopy.rollDeg.toFixed(1),
              pilotRoll: s.pilot.pendulumRollDeg.toFixed(1),
              canopyPitch: s.canopy.pitchDeg.toFixed(1),
              pilotPitch: s.pilot.pendulumPitchDeg.toFixed(1),
              yawRate: s.canopy.yawDeg.toFixed(1),
              speedKmh: s.telemetry.airspeedKmh.toFixed(1),
              vario: s.telemetry.verticalSpeedMps.toFixed(1),
              leftBrake: s.controls.leftBrake.toFixed(2),
              isStalled: s.isStalled,
              asymSide: s.asymmetricStallSide,
              tension: s.telemetry.lineTensionNewtons,
              leftTension: s.telemetry.leftLineTensionNewtons,
              rightTension: s.telemetry.rightLineTensionNewtons,
            };
          })()
        `,
        returnByValue: true,
      })
      console.log('Sample:', JSON.stringify(data.result?.value))
    }

    await send('Runtime.evaluate', {
      expression: `window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', bubbles: true }));`,
    })

    ws.close()
  } finally {
    chrome.kill()
  }
}

main().catch(console.error)
