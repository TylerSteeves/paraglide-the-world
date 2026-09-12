import { spawn } from 'node:child_process'
import { writeFile, copyFile } from 'node:fs/promises'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const debugPort = 9246
const gameUrl = 'http://127.0.0.1:5181/'
const artifactDir = '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3'

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('=== First-Principles 2-Body Flight Dynamics Test ===')
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

    // Launch Alpine flight
    await send('Runtime.evaluate', {
      expression: `
        const btn = document.getElementById('hud-launch-alpine-btn');
        if (btn) btn.click();
      `,
    })
    await delay(1000)

    // Evaluate in-browser physics directly
    const telemetryReport = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.sim;
          if (!sim) return { error: 'sim not found' };

          const results = {
            trim: null,
            rollResponse: null,
            flare: null,
            antiInversionTest: null,
          };

          // 1. Hands-off Trim Flight for 3 seconds in calm air
          sim.reset(2000, 0);
          sim.atmosphere.windSpeedKmh = 0;
          sim.atmosphere.turbulence = 0;
          sim.controls.leftBrake = 0;
          sim.controls.rightBrake = 0;
          sim.controls.weightShift = 0;
          sim.controls.speedBar = 0;

          let debugStep10 = null;
          const stepLogs = [];
          for (let i = 0; i < 300; i++) {
            if (i === 10) {
              const aero = window.sim.aeroState;
              debugStep10 = {
                rollDeg: sim.canopy.rollDeg,
                cOmegaZ: sim.cOmega?.z,
                leftLift: sim.telemetry.leftLineTensionNewtons,
                rightLift: sim.telemetry.rightLineTensionNewtons,
              };
            }
            if (i % 50 === 0 || i === 299) {
              stepLogs.push({
                i,
                rollDeg: sim.canopy.rollDeg,
                pitchDeg: sim.canopy.pitchDeg,
                airspeedKmh: sim.telemetry.airspeedKmh,
                verticalSpeedMps: sim.telemetry.verticalSpeedMps,
                glideRatio: sim.telemetry.glideRatio,
                tension: sim.telemetry.lineTensionNewtons,
              });
            }
            sim.step(0.01, () => 650);
          }
          results.debugStep10 = debugStep10;
          results.stepLogs = stepLogs;

          results.trim = {
            airspeedKmh: sim.telemetry.airspeedKmh,
            verticalSpeedMps: sim.telemetry.verticalSpeedMps,
            glideRatio: sim.telemetry.glideRatio,
            pitchDeg: sim.canopy.pitchDeg,
            rollDeg: sim.canopy.rollDeg,
            lineTensionN: sim.telemetry.lineTensionNewtons,
          };

          // 2. Roll Response: Apply 100% Left Brake & full weight shift for 0.7s
          const startRoll = sim.canopy.rollDeg;
          sim.controls.leftBrake = 1.0;
          sim.controls.weightShift = -1.0;

          let rollAt700ms = 0;
          const rollProgress = [];
          for (let i = 0; i < 70; i++) {
            sim.step(0.01, () => 650);
            if (i % 10 === 0 || i === 69) {
              rollProgress.push({
                i,
                rollDeg: sim.canopy.rollDeg,
                yawDeg: sim.canopy.yawDeg,
                pendulumRoll: sim.pilot.pendulumRollDeg,
              });
            }
            if (i === 69) rollAt700ms = sim.canopy.rollDeg;
          }

          results.rollResponse = {
            startRoll,
            rollAt700ms,
            deltaRollDeg: rollAt700ms - startRoll,
            pendulumRollDeg: sim.pilot.pendulumRollDeg,
            lineTensionN: sim.telemetry.lineTensionNewtons,
            gForce: sim.telemetry.gForce,
            rollProgress,
          };

          // 3. Dynamic Flare Test: Full brakes from trim flight
          sim.reset(2000, 0);
          sim.atmosphere.windSpeedKmh = 0;
          sim.atmosphere.turbulence = 0;
          sim.controls.leftBrake = 0;
          sim.controls.rightBrake = 0;
          sim.controls.weightShift = 0;
          sim.controls.speedBar = 0;
          for (let i = 0; i < 200; i++) sim.step(0.01, () => 650);
          const preFlareSink = sim.telemetry.verticalSpeedMps;

          // Pull full brake
          sim.controls.leftBrake = 1.0;
          sim.controls.rightBrake = 1.0;
          let bestCushionSink = preFlareSink;
          const flareSteps = [];
          for (let i = 0; i < 100; i++) {
            sim.step(0.01, () => 650);
            if (sim.telemetry.verticalSpeedMps > bestCushionSink) {
              bestCushionSink = sim.telemetry.verticalSpeedMps;
            }
            if (i % 20 === 0 || i === 99) {
              flareSteps.push({
                i,
                verticalSpeedMps: sim.telemetry.verticalSpeedMps,
                pitchDeg: sim.canopy.pitchDeg,
                airspeedKmh: sim.telemetry.airspeedKmh,
              });
            }
          }

          results.flare = {
            preFlareSink,
            maxClimbOrCushionSink: bestCushionSink,
            flareCushionDelta: bestCushionSink - preFlareSink,
            flareSteps,
          };

          // 4. Anti-Inversion Check: Hold full brake / hold hard turn for 5 seconds
          // Verify canopy pitch never inverts past 85 deg into an impossible backflip
          let maxPitch = -999;
          let minPitch = 999;
          for (let i = 0; i < 500; i++) {
            sim.step(0.01, () => 650);
            if (sim.canopy.pitchDeg > maxPitch) maxPitch = sim.canopy.pitchDeg;
            if (sim.canopy.pitchDeg < minPitch) minPitch = sim.canopy.pitchDeg;
          }

          results.antiInversionTest = {
            maxPitchDeg: maxPitch,
            minPitchDeg: minPitch,
            inverted: maxPitch > 85 || minPitch < -85,
          };

          return results;
        })()
      `,
      returnByValue: true,
    })

    console.log('Telemetry Results:')
    if (telemetryReport.exceptionDetails) {
      console.error('CDP Exception:', telemetryReport.exceptionDetails)
    } else {
      console.log(JSON.stringify(telemetryReport.result?.value, null, 2))
    }

    // Capture screenshot of the scene
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile('preview-2body-flight.png', Buffer.from(shot.data, 'base64'))
    await copyFile('preview-2body-flight.png', `${artifactDir}/preview-2body-flight.png`)

    ws.close()
  } finally {
    chrome.kill('SIGTERM')
  }
}

main().catch(console.error)
