import { spawn } from 'node:child_process'
import { writeFile, copyFile } from 'node:fs/promises'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const debugPort = 9247
const gameUrl = 'http://127.0.0.1:5181/'
const artifactDir = '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3'

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('=== Dual-Wing System & Himalayas Big Mountain XC Telemetry Test ===')
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

    console.log('Waiting for engine to initialize...')
    await delay(2500)

    // Launch Himalayas XC flight
    console.log('Launching Himalayas Big Mountain XC flight...')
    await send('Runtime.evaluate', {
      expression: `
        const btn = document.getElementById('hud-launch-himalayas-btn');
        if (btn) btn.click();
      `,
    })
    await delay(1200)

    // Evaluate in-browser physics directly
    const testReport = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.sim;
          const rig = window.rig;
          const mountain = window.himalayas;
          if (!sim) return { error: 'sim not found' };

          const results = {
            speedwingTrim: null,
            xcParagliderTrim: null,
            thermalClimbTest: null,
            xcDistanceTest: null,
          };

          // 1. Test Speedwing Profile
          sim.setWing('speedwing');
          sim.reset(2000, 0);
          sim.atmosphere.windSpeedKmh = 0;
          sim.atmosphere.turbulence = 0;
          sim.controls.leftBrake = 0;
          sim.controls.rightBrake = 0;
          sim.controls.weightShift = 0;
          sim.controls.speedBar = 0;
          for (let i = 0; i < 250; i++) sim.step(0.01, (x, z) => 650);

          results.speedwingTrim = {
            wingType: sim.telemetry.wingType,
            airspeedKmh: sim.telemetry.airspeedKmh,
            verticalSpeedMps: sim.telemetry.verticalSpeedMps,
            glideRatio: sim.telemetry.glideRatio,
            lineTensionN: sim.telemetry.lineTensionNewtons,
          };

          // 2. Test XC Paraglider Profile
          sim.setWing('paraglider');
          sim.reset(4200, 0);
          sim.atmosphere.windSpeedKmh = 0;
          sim.atmosphere.turbulence = 0;
          sim.controls.leftBrake = 0;
          sim.controls.rightBrake = 0;
          sim.controls.weightShift = 0;
          sim.controls.speedBar = 0;
          for (let i = 0; i < 250; i++) sim.step(0.01, (x, z) => 2500);

          results.xcParagliderTrim = {
            wingType: sim.telemetry.wingType,
            airspeedKmh: sim.telemetry.airspeedKmh,
            verticalSpeedMps: sim.telemetry.verticalSpeedMps,
            glideRatio: sim.telemetry.glideRatio,
            lineTensionN: sim.telemetry.lineTensionNewtons,
          };

          // 3. Test Thermal Climbing in Sarangkot Thermal Column (+5.2 m/s updraft)
          // Place glider inside thermal column at (250, 4200, 350)
          sim.reset(4200, 0, { x: 250, y: 4200, z: 350 });
          sim.atmosphere.windSpeedKmh = 0;
          sim.atmosphere.turbulence = 0;
          const startAlt = sim.pilot.position.y;
          const climbSteps = [];
          for (let i = 0; i < 300; i++) {
            const updraft = mountain ? mountain.sampleUpdraft(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z) : 5.0;
            sim.atmosphere.thermalUpdraftMps = updraft;
            sim.step(0.01, (x, z) => mountain ? mountain.sampleHeight(x, z) : 2500);
            if (i % 50 === 0 || i === 299) {
              climbSteps.push({
                i,
                altM: sim.pilot.position.y,
                varioMps: sim.telemetry.verticalSpeedMps,
                thermalUpdraft: updraft,
              });
            }
          }
          const endAlt = sim.pilot.position.y;

          results.thermalClimbTest = {
            startAltM: startAlt,
            endAltM: endAlt,
            altitudeGainM: endAlt - startAlt,
            varioClimbRateMps: sim.telemetry.verticalSpeedMps,
            climbSteps,
          };

          // 4. XC Distance Tracking Test
          results.xcDistanceTest = {
            xcDistanceM: sim.telemetry.xcDistanceMeters,
            maxAltitudeM: sim.telemetry.maxAltitudeMeters,
          };

          return results;
        })()
      `,
      returnByValue: true,
    })

    console.log('Telemetry Results:')
    if (testReport.exceptionDetails) {
      console.error('CDP Exception:', testReport.exceptionDetails)
    } else {
      console.log(JSON.stringify(testReport.result?.value, null, 2))
    }

    // 1. Capture Himalayas XC in Shoulder Chase
    console.log('Capturing Himalayas XC screenshot...')
    await send('Runtime.evaluate', {
      expression: `
        if (window.spawnHimalayas) window.spawnHimalayas();
        window.actionCam.vantage = 'shoulder-chase';
      `,
    })
    await delay(1500)
    const shotHimalayas = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('preview-himalayas-xc.png', Buffer.from(shotHimalayas.data, 'base64'))
    await copyFile('preview-himalayas-xc.png', `${artifactDir}/preview-himalayas-xc.png`)

    // 2. Switch to Whistler Downhill & Speedwing and capture in Shoulder Chase
    console.log('Spawning into Whistler Downhill...')
    await send('Runtime.evaluate', {
      expression: `
        if (window.spawnAlpine) window.spawnAlpine();
        window.actionCam.vantage = 'shoulder-chase';
      `,
    })
    await delay(1500)
    const shotDownhill = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('preview-speedwing-downhill.png', Buffer.from(shotDownhill.data, 'base64'))
    await copyFile('preview-speedwing-downhill.png', `${artifactDir}/preview-speedwing-downhill.png`)

    // 3. Show Launch Modal for Wing & Level Selection Preview
    console.log('Capturing Wing & Level Selection Modal...')
    await send('Runtime.evaluate', {
      expression: `
        const modal = document.getElementById('hud-start-modal');
        if (modal) modal.style.display = 'flex';
      `,
    })
    await delay(800)
    const shotModal = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('preview-wing-switcher.png', Buffer.from(shotModal.data, 'base64'))
    await copyFile('preview-wing-switcher.png', `${artifactDir}/preview-wing-switcher.png`)

    ws.close()
  } finally {
    chrome.kill('SIGTERM')
  }
}

main().catch(console.error)
