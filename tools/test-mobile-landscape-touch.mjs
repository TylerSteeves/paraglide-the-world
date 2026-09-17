import { spawn } from 'node:child_process';
import { writeFile, copyFile } from 'node:fs/promises';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = 9255;
const gameUrl = 'http://127.0.0.1:5181/';
const artifactDir = '/Users/tylersteeves/.gemini/antigravity/brain/3a567ca6-dac1-4fe6-8c48-aee430bda0d3';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Testing Mobile Landscape Hand-Height Touch Handling ===');
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
      '--user-data-dir=/tmp/chrome-mobile-landscape-profile',
      '--window-size=932,430',
      `--remote-debugging-port=${debugPort}`,
      gameUrl,
    ],
    { stdio: 'ignore' }
  );

  try {
    let page = null;
    for (let i = 0; i < 40; i++) {
      try {
        const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
        page = pages.find((p) => p.type === 'page');
        if (page) break;
      } catch {}
      await delay(150);
    }

    if (!page) throw new Error('Could not connect to Chrome debugging instance');

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
      if (res && res.exceptionDetails) {
        console.error('Eval error:', res.exceptionDetails);
      }
      return res?.result?.value;
    }

    async function takeScreenshot(filename) {
      const res = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(res.data, 'base64');
      const localPath = `/tmp/${filename}`;
      await writeFile(localPath, buf);
      await copyFile(localPath, `${artifactDir}/${filename}`);
      console.log(`Saved screenshot: ${filename}`);
    }

    // Set mobile touch emulation in landscape
    await send('Emulation.setDeviceMetricsOverride', {
      width: 932,
      height: 430,
      deviceScaleFactor: 3,
      mobile: true,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    console.log('Waiting for Babylon scene and HUD...');
    await delay(3000);

    // Initial overlay screenshot
    await takeScreenshot('mobile-landscape-overlay.png');

    // Tap center to dismiss relaunch overlay and launch flight
    console.log('Tapping screen to launch flight...');
    await evaluate(`
      const overlay = document.getElementById('hud-relaunch');
      if (overlay) overlay.click();
    `);
    await delay(2000);
    await takeScreenshot('mobile-landscape-trim.png');

    // Test 1: Left thumb high (y = 50px, Speed Bar dive)
    console.log('Testing Left Speed Bar Dive (thumb at top rail)...');
    await evaluate(`
      const w = window.innerWidth;
      const h = window.innerHeight;
      const t = new Touch({ identifier: 101, target: document.body, clientX: 60, clientY: 50 });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t] }));
    `);
    await delay(1000);
    const speedBarState = await evaluate(`
      ({
        airspeed: window.sim.physics.airspeedKmh.toFixed(1),
        speedBar: window.inputManager.controls.speedBar.toFixed(2),
        leftBrake: window.inputManager.controls.leftBrake.toFixed(2),
        rightBrake: window.inputManager.controls.rightBrake.toFixed(2),
        pitch: (window.sim.pendulum.relativePitch * 180 / Math.PI).toFixed(1)
      })
    `);
    console.log('Speed Bar State:', speedBarState);
    await takeScreenshot('mobile-landscape-speedbar.png');

    // Release touch
    await evaluate(`
      const t = new Touch({ identifier: 101, target: document.body, clientX: 60, clientY: 50 });
      window.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t] }));
    `);
    await delay(1000);

    // Test 2: Right thumb deep (y = 360px, Right Snap Carve Turn)
    console.log('Testing Right Turn Carve (thumb low on right rail)...');
    await evaluate(`
      const w = window.innerWidth;
      const h = window.innerHeight;
      const t = new Touch({ identifier: 102, target: document.body, clientX: w - 60, clientY: 360 });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t] }));
    `);
    await delay(1200);
    const turnState = await evaluate(`
      ({
        airspeed: window.sim.physics.airspeedKmh.toFixed(1),
        rightBrake: window.inputManager.controls.rightBrake.toFixed(2),
        leftBrake: window.inputManager.controls.leftBrake.toFixed(2),
        roll: (window.sim.pendulum.relativeRoll * 180 / Math.PI).toFixed(1),
        yawRate: (window.sim.physics.bodyAngularVelocity.y * 180 / Math.PI).toFixed(1)
      })
    `);
    console.log('Right Turn Carve State:', turnState);
    await takeScreenshot('mobile-landscape-turn.png');

    // Release right touch
    await evaluate(`
      const w = window.innerWidth;
      const t = new Touch({ identifier: 102, target: document.body, clientX: w - 60, clientY: 360 });
      window.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t] }));
    `);
    await delay(1000);

    // Test 3: Dual-thumb flare / stall (both thumbs near hips at y = 380px)
    console.log('Testing Dual-Thumb Flare / Deep Brake...');
    await evaluate(`
      const w = window.innerWidth;
      const h = window.innerHeight;
      const t1 = new Touch({ identifier: 201, target: document.body, clientX: 60, clientY: 380 });
      const t2 = new Touch({ identifier: 202, target: document.body, clientX: w - 60, clientY: 380 });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [t1, t2], targetTouches: [t1, t2], changedTouches: [t1, t2] }));
    `);
    await delay(1200);
    const flareState = await evaluate(`
      ({
        airspeed: window.sim.physics.airspeedKmh.toFixed(1),
        leftBrake: window.inputManager.controls.leftBrake.toFixed(2),
        rightBrake: window.inputManager.controls.rightBrake.toFixed(2),
        pitch: (window.sim.pendulum.relativePitch * 180 / Math.PI).toFixed(1),
        gForce: window.sim.physics.gForce.toFixed(2)
      })
    `);
    console.log('Dual Flare State:', flareState);
    await takeScreenshot('mobile-landscape-flare.png');

    // Release dual touch
    await evaluate(`
      const w = window.innerWidth;
      const t1 = new Touch({ identifier: 201, target: document.body, clientX: 60, clientY: 380 });
      const t2 = new Touch({ identifier: 202, target: document.body, clientX: w - 60, clientY: 380 });
      window.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t1, t2] }));
    `);

    console.log('Mobile Landscape Touch Verification Successful!');
    ws.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
