// Screenshots per Playwright/Chromium headless mit frischem, temporärem Profil (keine Anmeldedaten).
// Aufruf: node tools/screenshots.js <basis-url> <ausgabeordner>
const pwPath = process.env.PW_PATH || 'playwright';
const { chromium } = require(pwPath);
const base = process.argv[2] || 'http://127.0.0.1:8765/';
const outDir = process.argv[3] || 'screenshots';
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const views = [
  { name: '01-btc-live-1h-indikatoren', q: 'sym=BTCUSDT&tf=1h&ind=ema,bb,rsi,macd&demo=1&alarmPct=1.5', wait: 6000 },
  { name: '02-eth-15m-miniscript-ema-kreuzung', q: 'sym=ETHUSDT&tf=15m&ind=rsi&ex=1', wait: 5000 },
  { name: '03-testmodus-alarm-ausgeloest', q: 'sym=BTCUSDT&tf=5m&test=1&ind=ema,vwap,rsi&demo=1&alarmPct=0.03', waitFor: () => window.__sarge.state.alarms.some((a) => a.fired), wait: 1200 },
  { name: '04-nvda-tageschart-sma-bb', q: 'sym=NVDA&tf=1d&ind=sma,ema,bb,macd', wait: 2500 },
  { name: '05-sol-5m-fadenkreuz-werte', q: 'sym=SOLUSDT&tf=5m&ind=ema,bb,vwap,rsi,macd', wait: 5000, hover: [0.55, 0.35] },
  { name: '06-sap-1h-script-panel-rsi', q: 'sym=SAP&tf=1h&ind=bb&ex=3', wait: 2500 },
  { name: '07-btc-4h-donchian-kanal', q: 'sym=BTCUSDT&tf=4h&ind=macd&ex=5', wait: 5000 },
  { name: '09-btc-1h-strategie-supertrend-backtest', q: 'sym=BTCUSDT&tf=1h&ind=&ex=7', wait: 6000 },
  { name: '10-eth-4h-strategie-ema-backtest', q: 'sym=ETHUSDT&tf=4h&ind=rsi&ex=6', wait: 6000 },
  { name: '11-sol-15m-replay-supertrend', q: 'sym=SOLUSDT&tf=15m&ind=st,ema&ex=0&replay=1', wait: 7000 },
  { name: '12-btc-1m-orderbuch-live', q: 'sym=BTCUSDT&tf=1m&ind=vwap,ema&ex=0', wait: 8000 },
];
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  for (const v of views.filter((v) => !only || only.some((o) => v.name.startsWith(o)))) {
    await page.goto(base + '?' + v.q, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
    if (v.waitFor) await page.waitForFunction(v.waitFor, null, { timeout: 120000, polling: 300 });
    await page.waitForTimeout(v.wait);
    if (v.hover) {
      const box = await page.locator('#pane-main').boundingBox();
      await page.mouse.move(box.x + box.width * v.hover[0], box.y + box.height * v.hover[1], { steps: 8 });
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: `${outDir}/${v.name}.png` });
    const info = await page.evaluate(() => ({ src: window.__sarge.state.source, bars: window.__sarge.state.bars.length, ticks: window.__sarge.state.ticks, conn: document.querySelector('#conn span').textContent, script: document.querySelector('#scriptOut').textContent, bt: document.querySelector('#btStats').textContent.slice(0, 160), book: document.querySelector('#bookCard').style.display !== 'none', replay: window.__sarge.state.replay.on, replayPos: window.__sarge.state.replay.pos }));
    console.log(v.name, JSON.stringify(info));
  }
  // Bedienung per Maus: Trendlinie und Alarm wirklich anklicken
  await page.goto(base + '?sym=ETHUSDT&tf=1h&test=1&ind=ema,rsi', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(1000);
  const box = await page.locator('#pane-main').boundingBox();
  await page.click('[data-tool="trend"]');
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.75);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45, { steps: 10 });
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.3);
  await page.click('[data-tool="hline"]');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await page.click('[data-tool="alarm"]');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 5 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/08-zeichnen-per-mausklick.png` });
  console.log('08 Zeichnungen', JSON.stringify(await page.evaluate(() => ({ trends: window.__sarge.state.trends.length, hlines: window.__sarge.state.hlines.length, alarms: window.__sarge.state.alarms.length }))));
  // Fibonacci und Position per Maus
  await page.goto(base + '?sym=BTCUSDT&tf=4h&ind=ema&ex=0', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(3500);
  const bx = await page.locator('#pane-main').boundingBox();
  await page.click('[data-tool="fib"]');
  await page.mouse.click(bx.x + bx.width * 0.18, bx.y + bx.height * 0.22);
  await page.mouse.move(bx.x + bx.width * 0.4, bx.y + bx.height * 0.5, { steps: 8 });
  await page.mouse.click(bx.x + bx.width * 0.52, bx.y + bx.height * 0.68);
  await page.click('[data-tool="pos"]');
  await page.mouse.click(bx.x + bx.width * 0.7, bx.y + bx.height * 0.5);
  await page.mouse.click(bx.x + bx.width * 0.78, bx.y + bx.height * 0.28);
  await page.mouse.click(bx.x + bx.width * 0.78, bx.y + bx.height * 0.6);
  await page.mouse.move(bx.x + bx.width * 0.3, bx.y + bx.height * 0.9, { steps: 5 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/13-fibonacci-und-position.png` });
  console.log('13 Fibonacci/Position', JSON.stringify(await page.evaluate(() => window.__sarge.layer.shapes.map((s) => s.type))));
  // Doppelklick-Start: index.html direkt als Datei (file://)
  if (process.env.FILE_URL) {
    await page.goto(process.env.FILE_URL + '?sym=BTCUSDT&tf=15m', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
    await page.waitForTimeout(4000);
    console.log('file:// Start', JSON.stringify(await page.evaluate(() => ({ src: window.__sarge.state.source, bars: window.__sarge.state.bars.length, conn: document.querySelector('#conn span').textContent }))));
  }
  console.log('Konsole:', logs.length ? logs.join('\n') : 'keine Fehler');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
