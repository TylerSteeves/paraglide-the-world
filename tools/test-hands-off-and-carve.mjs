import { spawn } from 'node:child_process';
import { writeFile, copyFile } from 'node:fs/promises';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = 9258;
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
      '--disable-background-networking',
      '--user-data-dir=/tmp/chrome-paraglide-stable',
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

    async function evaluate(code) {
      const res = await send('Runtime.evaluate', { expression: `(() => { ${code} })()`, returnByValue: true });
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

    await send('Emulation.setDeviceMetricsOverride', {
      width: 932,
      height: 430,
      deviceScaleFactor: 3,
      mobile: true,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    await delay(3500);
    await evaluate(`const el = document.getElementById('hud-relaunch'); if (el) el.click();`);
    await delay(1500);

    // 1. Hands-off Trim Flight (Open Brakes, floating peacefully at 50-55 km/h)
    console.log('Capturing Hands-Off Open Trim flight...');
    await delay(2000);
    await takeScreenshot('mobile-landscape-open-trim-stable.png');

    // 2. Gentle Carving Turn (thumb pulled ~40% down right edge)
    console.log('Dispatching Gentle Right Carve Turn...');
    await evaluate(`
      const touch = new Touch({ identifier: 1, target: document.body, clientX: window.innerWidth - 60, clientY: window.innerHeight * 0.45 });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    `);
    await delay(1500);
    await takeScreenshot('mobile-landscape-gentle-carve.png');

    // 3. Release touch back to Open Trim (Hands-off recovery)
    console.log('Releasing touch back to Open Trim...');
    await evaluate(`
      const touch = new Touch({ identifier: 1, target: document.body, clientX: window.innerWidth - 60, clientY: window.innerHeight * 0.45 });
      window.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [touch] }));
    `);
    await delay(1800);
    await takeScreenshot('mobile-landscape-recovered-trim.png');

    // 4. Dual Brake Flare (pulling both thumbs down to 80%)
    console.log('Dispatching Dual Brake Flare...');
    await evaluate(`
      const t1 = new Touch({ identifier: 1, target: document.body, clientX: 60, clientY: window.innerHeight * 0.78 });
      const t2 = new Touch({ identifier: 2, target: document.body, clientX: window.innerWidth - 60, clientY: window.innerHeight * 0.78 });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [t1, t2], targetTouches: [t1, t2], changedTouches: [t1, t2] }));
    `);
    await delay(1200);
    await takeScreenshot('mobile-landscape-dual-flare.png');

    console.log('All tests completed successfully!');
    ws.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

main().catch(console.error);
