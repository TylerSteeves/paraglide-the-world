import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = 9272;
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
      '--user-data-dir=/tmp/chrome-tension-tether',
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

    if (!page) throw new Error('Failed to find page');

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
      if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
      return res.result.value;
    }

    async function captureScreenshot(name) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(data, 'base64');
      await writeFile(`${artifactDir}/${name}.png`, buf);
      console.log(`Saved screenshot: ${name}.png`);
    }

    await send('Page.enable');
    await send('Runtime.enable');

    for (let i = 0; i < 50; i++) {
      if (await evaluate(`Boolean(window.sim && window.startFlight)`)) break;
      await delay(200);
    }

    await evaluate(`window.startFlight()`);
    await delay(1500);

    // Fast downward touch drag on left edge: finger moves to Y=320 while handle lags behind at high speed
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 50, y: 110, id: 1 }]
    });
    await delay(50);

    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 50, y: 310, id: 1 }]
    });
    await delay(80); // mid-drag with active elastic lag

    const state = await evaluate(`({
      lagFrac: window.inputManager.leftLagFrac,
      leftBrake: window.sim.controls.leftBrake,
      leftForceN: window.sim.telemetry.leftBrakeForceN,
      thumbYFrac: window.inputManager.leftThumbYFrac
    })`);
    console.log('Active drag state:', JSON.stringify(state, null, 2));

    await captureScreenshot('mobile-tension-tether-elastic');

    await send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    });

    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch(console.error);
