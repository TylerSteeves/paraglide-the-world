import { spawn } from 'node:child_process'
import { writeFile, copyFile } from 'node:fs/promises'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const debugPort = 9248
const gameUrl = 'http://127.0.0.1:5181/'
const artifactDir = '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3'

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('=== Testing Pure Dynamic Acro Physics & Minimalist Mobile HUD ===')
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
      '--user-data-dir=/tmp/chrome-acro-profile',
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
      throw new Error('Could not connect to Chrome debugging instance')
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

    // Tap/Click to start flight
    console.log('Starting flight session...')
    await send('Runtime.evaluate', {
      expression: `
        if (window.startFlight) {
          window.startFlight();
        } else {
          const overlay = document.getElementById('hud-relaunch');
          if (overlay) overlay.click();
        }
      `,
    })
    await delay(1200)

    // Run physics test suite directly in sim engine
    const testResults = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const sim = window.sim;
          if (!sim) return { error: 'sim not found' };

          const results = {
            trim: null,
            violentAsymmetricSnap: null,
            violentDynamicSurgeAndLoop: null,
          };

          // 1. Hands-off Trim Test
          sim.reset(2050, 5);
          sim.atmosphere.windSpeedKmh = 0;
          sim.atmosphere.turbulence = 0;
          sim.controls.leftBrake = 0;
          sim.controls.rightBrake = 0;
          sim.controls.leftBrakeRate = 0;
          sim.controls.rightBrakeRate = 0;
          sim.controls.weightShift = 0;
          sim.controls.speedBar = 0;

          for (let i = 0; i < 200; i++) {
            sim.step(0.01, () => 1500);
          }

          results.trim = {
            airspeedKmh: sim.telemetry.airspeedKmh,
            verticalSpeedMps: sim.telemetry.verticalSpeedMps,
            glideRatio: sim.telemetry.glideRatio,
            lineTensionN: sim.telemetry.lineTensionNewtons,
            rollDeg: sim.canopy.rollDeg,
            pitchDeg: sim.canopy.pitchDeg,
          };

          // 2. Violent Asymmetric Brake Yank (Snap roll/yaw)
          // Yank left brake from 0 to 1.0 at high rate (d_brake/dt = 15 s^-1)
          const rollBefore = sim.canopy.rollDeg;
          const yawBefore = sim.canopy.yawDeg;
          sim.controls.leftBrake = 1.0;
          sim.controls.leftBrakeRate = 18.0;
          sim.controls.weightShift = -1.0;

          const trajectory = [];
          for (let i = 0; i < 60; i++) { // 0.6 seconds of violent snap
            sim.step(0.01, () => 1500);
            if (i % 10 === 0) {
              trajectory.push({
                t: i * 0.01,
                roll: sim.canopy.rollDeg,
                yaw: sim.canopy.yawDeg,
                gForce: sim.telemetry.gForce,
                lineTensionN: sim.telemetry.lineTensionNewtons,
              });
            }
          }

          results.violentAsymmetricSnap = {
            startRoll: rollBefore,
            endRoll: sim.canopy.rollDeg,
            rollRateDegPerSec: (sim.canopy.rollDeg - rollBefore) / 0.6,
            deltaYawDeg: sim.canopy.yawDeg - yawBefore,
            peakGForce: Math.max(...trajectory.map(t => t.gForce)),
            peakTensionN: Math.max(...trajectory.map(t => t.lineTensionN)),
            trajectory,
          };

          // 3. Violent Symmetric Dynamic Surge & Loop / Tumble Test
          // Accelerate to high dive speed (speed bar), then slam both brakes hard, release, and catch surge!
          sim.reset(2050, 0);
          sim.controls.leftBrake = 0;
          sim.controls.rightBrake = 0;
          sim.controls.speedBar = 1.0; // Dive
          for (let i = 0; i < 150; i++) sim.step(0.01, () => 1200);

          const diveSpeed = sim.telemetry.airspeedKmh;

          // Violent pull: both brakes slammed down (rate = 20 s^-1)
          sim.controls.speedBar = 0;
          sim.controls.leftBrake = 1.0;
          sim.controls.rightBrake = 1.0;
          sim.controls.leftBrakeRate = 20.0;
          sim.controls.rightBrakeRate = 20.0;

          let maxPendulumPitch = 0;
          for (let i = 0; i < 50; i++) {
            sim.step(0.01, () => 1200);
            if (sim.pilot.pendulumPitchDeg > maxPendulumPitch) {
              maxPendulumPitch = sim.pilot.pendulumPitchDeg;
            }
          }

          // Release brakes to let wing surge violently forward down in front
          sim.controls.leftBrake = 0;
          sim.controls.rightBrake = 0;
          sim.controls.leftBrakeRate = -15.0;
          sim.controls.rightBrakeRate = -15.0;

          let minPendulumPitch = 0;
          for (let i = 0; i < 40; i++) {
            sim.step(0.01, () => 1200);
            if (sim.pilot.pendulumPitchDeg < minPendulumPitch) {
              minPendulumPitch = sim.pilot.pendulumPitchDeg;
            }
          }

          // Slam brakes at the bottom of the pendulum swing to catch surge and sling pilot over!
          sim.controls.leftBrake = 1.0;
          sim.controls.rightBrake = 1.0;
          sim.controls.leftBrakeRate = 20.0;
          sim.controls.rightBrakeRate = 20.0;

          let peakCumulativePitch = 0;
          for (let i = 0; i < 100; i++) {
            sim.step(0.01, () => 1200);
            if (Math.abs(sim.cumulativePitchDeg) > peakCumulativePitch) {
              peakCumulativePitch = Math.abs(sim.cumulativePitchDeg);
            }
          }

          results.violentDynamicSurgeAndLoop = {
            diveSpeedKmh: diveSpeed,
            maxForwardSwingPitchDeg: maxPendulumPitch,
            maxSurgeLagPitchDeg: minPendulumPitch,
            peakCumulativePitchDeg: peakCumulativePitch,
            tumbleStreak: sim.telemetry.tumbleStreak,
          };

          return results;
        })()
      `,
      returnByValue: true,
    })

    console.log('Physics Test Results:')
    console.log(JSON.stringify(testResults.result?.value, null, 2))

    // Capture screenshot of clean, minimalist mobile HUD in shoulder chase
    console.log('Capturing Minimalist Mobile HUD screenshot...')
    await send('Runtime.evaluate', {
      expression: `
        if (window.relaunchFlight) window.relaunchFlight();
        window.actionCam.vantage = 'shoulder-chase';
      `,
    })
    await delay(1500)

    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    const filename = 'preview-minimal-mobile-hud.png'
    await writeFile(filename, Buffer.from(screenshot.data, 'base64'))
    await copyFile(filename, `${artifactDir}/${filename}`)
    console.log(`Saved screenshot to ${filename} and artifact directory!`)

    ws.close()
  } finally {
    chrome.kill('SIGTERM')
  }
}

main().catch(console.error)
