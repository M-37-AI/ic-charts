// Prüft das Claude-Panel gegen den Server im Probelauf (AGENT_MOCK=1): Verbindung, Werkzeugaufruf im Browser, Antwort.
// Aufruf: PW_PATH=... node tools/agent-test.js http://127.0.0.1:8787/ screenshots
const { chromium } = require(process.env.PW_PATH || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8787/';
const outDir = process.argv[3] || 'screenshots';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(base + '?sym=BTCUSDT&tf=1h&ind=ema&ex=0&claude=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('#agStatus').classList.contains('live'), null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.fill('#agText', 'Zeichne ein Fibonacci vom letzten Hoch zum Tief.');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.ag-tool.done').length >= 3, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/14-claude-im-chart.png` });
  console.log(JSON.stringify(await page.evaluate(() => ({
    status: document.querySelector('#agStatus span').textContent,
    tools: [...document.querySelectorAll('.ag-tool')].map((t) => t.className + ' ' + t.querySelector('b').textContent),
    answer: [...document.querySelectorAll('.ag-msg.assistant')].map((m) => m.textContent).join(' | '),
    shapes: window.__sarge.layer.shapes.map((s) => s.type), cost: document.querySelector('#agCost').textContent,
  }))));
  console.log('Konsole:', logs.length ? logs.join('\n') : 'keine Fehler');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
