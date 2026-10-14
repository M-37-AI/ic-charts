// Prüft die Chart-Werkzeuge direkt im Browser (ohne Server): Wendepunkte, Analyse-Zeichnungen, Strategie-Labor.
// Aufruf: PW_PATH=... node tools/tools-test.js http://127.0.0.1:8765/ screenshots
const { chromium } = require(process.env.PW_PATH || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8765/';
const outDir = process.argv[3] || 'screenshots';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(base + '?sym=BTCUSDT&tf=4h&ind=ema&ex=0', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(3000);
  // 1) Analyse-Zeichnungen aus echten Wendepunkten
  const r1 = await page.evaluate(async () => {
    const T = window.__agent.TOOLS;
    const pv = T.find_pivots({ lookback: 200, strength: 5 });
    const lows = pv.pivots.filter((p) => p.type === 'low').slice(-3), highs = pv.pivots.filter((p) => p.type === 'high').slice(-3);
    T.draw_line({ from_bars_ago: lows[0].bars_ago, from_price: lows[0].price, to_bars_ago: lows[lows.length - 1].bars_ago, to_price: lows[lows.length - 1].price, label: 'Aufwärtstrend', kind: 'support' });
    T.draw_level({ price: highs[highs.length - 1].price, label: 'Widerstand', kind: 'resistance', from_bars_ago: 120 });
    T.draw_level({ price: lows[lows.length - 1].price, label: 'Unterstützung', kind: 'support', from_bars_ago: 120 });
    T.draw_zone({ price_low: lows[lows.length - 1].price * 0.995, price_high: lows[lows.length - 1].price * 1.01, from_bars_ago: 60, to_bars_ago: 0, label: 'Nachfragezone', kind: 'bull' });
    const pts = [...highs.slice(-2), ...lows.slice(-2)].sort((a, b) => b.bars_ago - a.bars_ago).map((p) => ({ bars_ago: p.bars_ago, price: p.price }));
    T.draw_pattern({ points: pts, label: 'Dreieck', closed: true });
    T.annotate({ bars_ago: 0, text: 'aktuell', kind: 'neutral' });
    return { pivots: pv.pivots.length, shapes: window.__sarge.layer.shapes.map((s) => s.type) };
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/15-claude-analyse-zeichnungen.png` });
  console.log('Zeichnungen', JSON.stringify(r1));
  // 2) Strategie-Labor
  await page.evaluate(() => window.__sarge.clearDrawings());
  const r2 = await page.evaluate(async () => {
    const T = window.__agent.TOOLS;
    const code = 'schnell = ema(close, $f)\nlangsam = ema(close, $s)\nplot(schnell, "orange")\nplot(langsam, "lila")\nbuy(crossover(schnell, langsam))\nsell(crossunder(schnell, langsam))';
    const r = await T.optimize_strategy({ code, param1: { name: 'f', from: 5, to: 30, step: 5 }, param2: { name: 's', from: 20, to: 80, step: 10 } });
    return { combos: r.combos, ms: r.ms, best: r.best.params, best_ret: r.best.ret, bh: r.buy_hold, beat: r.beat_buy_hold, robust: r.robustness };
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/16-strategie-labor-hitzekarte.png` });
  console.log('Labor', JSON.stringify(r2));
  console.log('Konsole:', logs.length ? logs.join('\n') : 'keine Fehler');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
