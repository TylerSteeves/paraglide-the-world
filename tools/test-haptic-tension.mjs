import { spawn } from 'node:child_process';
import { writeFile, copyFile } from 'node:fs/promises';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = 9268;
const gameUrl = 'http://127.0.0.1:5181/';
const artifactDir = '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      '--remote-allow-origins=*',
      '--disable-background-networking',
      '--user-data-dir=/tmp/chrome-haptic-tension',
      '--window-size=932,430',
      `--remote-debugging-port=${debugPort}`,
      gameUrl,
    ],
    { stdio: 'ignore' }
  );

  try {
    let page = null;
    for (let i = 0; i < 60; i++) {
      try {
        const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
        page = pages.find((p) => p.type === 'page');
        if (page) break;
      } catch {}
      await delay(200);
    }

    if (!page) {
      throw new Error(`Failed to connect to headless Chrome on port ${debugPort}`);
    }

    const ws = new WebSocket(page.webSocketDebuggerUrl);

    await new Promise((resolve) => (ws.onopen = resolve));

    let id = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const msgId = id++;
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === msgId) {
            ws.removeEventListener('message', handler);
            resolve(data.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    async function evaluate(expression) {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(JSON.stringify(res.exceptionDetails));
      }
      return res.result.value;
    }

    async function captureScreenshot(name) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(data, 'base64');
      const filename = `${artifactDir}/${name}.png`;
      await writeFile(filename, buf);
      console.log(`Saved screenshot: ${name}.png`);
    }

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Waiting for sim to load...');
    for (let i = 0; i < 50; i++) {
      const ready = await evaluate(`Boolean(window.sim && window.startFlight)`);
      if (ready) break;
      await delay(200);
    }

    console.log('Starting flight...');
    await evaluate(`window.startFlight()`);
    await delay(1000);

    // 1. Hands-Off Open Trim Flight (3 seconds)
    console.log('--- Phase 1: Hands-Off Open Trim ---');
    await delay(2500);
    const trimTelemetry = await evaluate(`({
      speedKmh: window.sim.telemetry.airspeedKmh,
      sinkMps: window.sim.telemetry.verticalSpeedMps,
      lineTensionN: window.sim.telemetry.lineTensionNewtons,
      leftForceN: window.sim.telemetry.leftBrakeForceN,
      rightForceN: window.sim.telemetry.rightBrakeForceN,
      stallWarning: window.sim.telemetry.stallWarning,
      isStalled: window.sim.telemetry.isStalled,
      rollDeg: window.sim.telemetry.bankDeg
    })`);
    console.log('Trim Telemetry:', JSON.stringify(trimTelemetry, null, 2));
    await captureScreenshot('mobile-haptic-trim');

    // 2. Normal Banked Carve (Left Brake ~ 28%)
    console.log('--- Phase 2: Banked Carve with Progressive Line Tension ---');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyA', key: 'a' });
    await delay(2000);
    const carveTelemetry = await evaluate(`({
      speedKmh: window.sim.telemetry.airspeedKmh,
      sinkMps: window.sim.telemetry.verticalSpeedMps,
      lineTensionN: window.sim.telemetry.lineTensionNewtons,
      leftForceN: window.sim.telemetry.leftBrakeForceN,
      rightForceN: window.sim.telemetry.rightBrakeForceN,
      leftBrake: window.sim.controls.leftBrake,
      stallWarning: window.sim.telemetry.stallWarning,
      rollDeg: window.sim.telemetry.bankDeg,
      gForce: window.sim.telemetry.gForce
    })`);
    console.log('Carve Telemetry:', JSON.stringify(carveTelemetry, null, 2));
    await captureScreenshot('mobile-haptic-carve-tension');
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
    await delay(1000);

    // 3. Dual Flare / Heavy Pull (Both Brakes ~ 85%)
    console.log('--- Phase 3: Dual Flare & High-G Line Strain ---');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'ShiftLeft', key: 'Shift' });
    await delay(1200);
    const flareTelemetry = await evaluate(`({
      speedKmh: window.sim.telemetry.airspeedKmh,
      sinkMps: window.sim.telemetry.verticalSpeedMps,
      lineTensionN: window.sim.telemetry.lineTensionNewtons,
      leftForceN: window.sim.telemetry.leftBrakeForceN,
      rightForceN: window.sim.telemetry.rightBrakeForceN,
      stallWarning: window.sim.telemetry.stallWarning,
      isStalled: window.sim.telemetry.isStalled
    })`);
    console.log('Flare Telemetry:', JSON.stringify(flareTelemetry, null, 2));
    await captureScreenshot('mobile-haptic-flare-strain');

    // 4. Full Stall Breakaway (Hold deep until airflow separates)
    console.log('--- Phase 4: Stall Breakaway & Pressure Collapse ---');
    await delay(2000); // continue holding shift to bleed speed below 25 km/h
    const stallTelemetry = await evaluate(`({
      speedKmh: window.sim.telemetry.airspeedKmh,
      sinkMps: window.sim.telemetry.verticalSpeedMps,
      lineTensionN: window.sim.telemetry.lineTensionNewtons,
      leftForceN: window.sim.telemetry.leftBrakeForceN,
      rightForceN: window.sim.telemetry.rightBrakeForceN,
      stallWarning: window.sim.telemetry.stallWarning,
      leftStalled: window.sim.telemetry.leftStalled,
      rightStalled: window.sim.telemetry.rightStalled,
      isStalled: window.sim.telemetry.isStalled
    })`);
    console.log('Stall Breakaway Telemetry:', JSON.stringify(stallTelemetry, null, 2));
    await captureScreenshot('mobile-haptic-stall-breakaway');
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift' });

    ws.close();
    console.log('Test completed successfully!');
  } finally {
    chrome.kill();
  }
}

main().catch(console.error);
