/*
 * app.js – Oberfläche, Daten, Live-Anbindung und Zeichenwerkzeuge von "iC Charts".
 * Eigener Code. Darstellung über Lightweight Charts 4.2.0 (Apache 2.0).
 */
(() => {
  'use strict';
  const LW = window.LightweightCharts;
  const I = window.Indicators;
  const SNAP = window.SNAPSHOT || { krypto: {}, aktien: {} };
  const $ = (s) => document.querySelector(s);

  // ---------------- Konfiguration ----------------
  const CRYPTO = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const STOCKS = ['AAPL', 'NVDA', 'MSFT', 'SAP'];
  const TFS = [
    { id: '1m', label: '1m', sec: 60 }, { id: '5m', label: '5m', sec: 300 }, { id: '15m', label: '15m', sec: 900 },
    { id: '1h', label: '1h', sec: 3600 }, { id: '4h', label: '4h', sec: 14400 }, { id: '1d', label: '1D', sec: 86400 },
  ];
  const IND = [
    { id: 'sma', label: 'SMA 50', color: '#ffd166' },
    { id: 'ema', label: 'EMA 21', color: '#ff9f43' },
    { id: 'bb', label: 'BB 20,2', color: '#4d8dff' },
    { id: 'vwap', label: 'VWAP', color: '#ff6bcb' },
    { id: 'st', label: 'SuperTrend', color: '#3ddc97' },
    { id: 'rsi', label: 'RSI 14', color: '#b388ff' },
    { id: 'macd', label: 'MACD', color: '#22d3ee' },
    { id: 'btcd', label: 'BTC.D', color: '#f7931a' },
  ];
  const C = { bg: '#15171c', grid: 'rgba(255,255,255,0.045)', text: '#8b93a1', line: '#272b33', up: '#3ddc97', down: '#ff6b7a', accent: '#f5b942', warn: '#f5b942' };
  const EXAMPLES = [
    { name: 'EMA-Kreuzung', code: '// Schnelle gegen langsame EMA\nschnell = ema(close, 9)\nlangsam = ema(close, 21)\nplot(schnell, "orange")\nplot(langsam, "lila")\nalert(crossover(schnell, langsam), "Kreuz hoch")' },
    { name: 'Bollinger-Ausbruch', code: '// Ausbruch über das obere Band\noben = bbupper(close, 20, 2)\nplot(oben, "blau", "BB oben")\nplot(bblower(close, 20, 2), "blau", "BB unten")\nalert(crossover(close, oben), "Ausbruch")' },
    { name: 'RSI-Wende', code: '// RSI kommt aus dem überverkauften Bereich\nr = rsi(close, 14)\npanel(r, "lila", "RSI")\npanel(ema(r, 9), "orange", "RSI-Signal")\nalert(crossover(r, 30), "RSI dreht")' },
    { name: 'Abstand SMA', code: '// Wie weit ist der Kurs von der SMA 50 weg? (in %)\npanel(close / sma(close, 50) * 100 - 100, "cyan", "Abstand SMA50 %")' },
    { name: 'Eigener Kanal', code: '// Donchian-Kanal: höchstes Hoch / tiefstes Tief\nplot(highest(high, 20), "grün", "Hoch 20")\nplot(lowest(low, 20), "rot", "Tief 20")\nalert(high >= highest(high, 50), "Neues 50er-Hoch")' },
    { name: 'Strategie EMA', code: '// Strategie: kaufen beim Kreuz nach oben, verkaufen beim Kreuz nach unten\n// buy/sell starten den Backtest (nur long, nächste Eröffnung, 0,1 % Gebühr)\nschnell = ema(close, 9)\nlangsam = ema(close, 21)\nplot(schnell, "orange")\nplot(langsam, "lila")\nbuy(crossover(schnell, langsam))\nsell(crossunder(schnell, langsam))' },
    { name: 'Strategie SuperTrend', code: '// SuperTrend (10, 3): Linie unter dem Kurs = Aufwärtstrend\nst = supertrend(10, 3)\nplot(st, "cyan", "SuperTrend")\nbuy(crossover(close, st))\nsell(crossunder(close, st))' },
  ];
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('sarge.' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('sarge.' + k, JSON.stringify(v)); } catch (e) { /* privater Modus o. ä. */ } },
  };

  const params = new URLSearchParams(location.search);
  const state = {
    symbol: (params.get('sym') || 'BTCUSDT').toUpperCase(),
    tf: params.get('tf') || '1h',
    test: params.get('test') === '1',
    ind: Object.fromEntries(IND.map((d) => [d.id, false])),
    bars: [], times: [], timeIndex: new Map(), source: '', kind: 'crypto',
    tool: 'cross', trendStart: null, trends: [], hlines: [], alarms: [],
    lastPrice: null, prevTickPrice: null, watch: {}, ticks: 0, lastMsg: 0,
    script: { text: '', outputs: [], series: [], lines: [], notified: new Set(), bt: null },
    ws: null, wsWatch: null, wsBook: null, sim: null, loadToken: 0,
    replay: { on: false, full: null, pos: 0, sub: 0, timer: null, playing: false },
    // Bitcoin-Dominanz: Historie (Server-Proxy oder Schnappschuss) + Live-Punkt, zusammengeführt in points
    dom: { hist: null, live: null, liveUsed: false, points: [], source: '', loading: null, lastLive: 0 },
  };
  (params.has('ind') ? params.get('ind') : (store.get('ind') ?? 'ema,bb,rsi,macd')).split(',').forEach((k) => { if (k in state.ind) state.ind[k] = true; });

  // ---------------- Hilfen ----------------
  const isNum = I.isNum;
  const precisionFor = (p) => (p >= 1 ? 2 : p >= 0.01 ? 4 : 6);
  const fmt = (v, d) => (isNum(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
  const fmtP = (v) => fmt(v, precisionFor(Math.abs(state.lastPrice || v || 1)));
  const fmtVol = (v) => (v >= 1e9 ? fmt(v / 1e9, 2) + ' Mrd' : v >= 1e6 ? fmt(v / 1e6, 2) + ' Mio' : v >= 1e3 ? fmt(v / 1e3, 1) + ' Tsd' : fmt(v, 2));
  // Lightweight Charts zeigt UTC – wir verschieben die Anzeigezeit in die lokale Zeitzone
  const dispTime = (t) => t - new Date(t * 1000).getTimezoneOffset() * 60;
  const tfSec = () => TFS.find((t) => t.id === state.tf).sec;
  const isStock = (s) => STOCKS.includes(s);
  function fetchTimeout(url, ms) {
    const ctl = new AbortController(); const id = setTimeout(() => ctl.abort(), ms);
    return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(id));
  }
  function toast(title, text, kind = '') {
    const el = document.createElement('div'); el.className = 'toast ' + kind;
    el.innerHTML = `<b></b><span></span>`; el.querySelector('b').textContent = title; el.querySelector('span').textContent = text;
    $('#toasts').prepend(el); setTimeout(() => el.remove(), 7000);
  }
  let audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach((d, k) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = k === 2 ? 1320 : 880; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + d + 0.15);
        o.connect(g).connect(audioCtx.destination); o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + 0.16);
      });
    } catch (e) { /* kein Ton möglich */ }
  }

  // ---------------- Charts / Panes ----------------
  function baseOptions() {
    return {
      autoSize: true,
      layout: { attributionLogo: false, background: { type: 'solid', color: C.bg }, textColor: C.text, fontSize: 11, fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
      grid: { vertLines: { color: C.grid, style: LW.LineStyle.Dotted }, horzLines: { color: C.grid, style: LW.LineStyle.Dotted } },
      crosshair: {
        mode: LW.CrosshairMode.Normal,
        vertLine: { color: 'rgba(245,185,66,0.55)', width: 1, style: LW.LineStyle.Dashed, labelBackgroundColor: '#3a3324' },
        horzLine: { color: 'rgba(245,185,66,0.55)', width: 1, style: LW.LineStyle.Dashed, labelBackgroundColor: '#3a3324' },
      },
      rightPriceScale: { borderColor: C.line, minimumWidth: 84 },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      localization: { locale: 'de-DE' },
    };
  }
  function makePane(id, cls) {
    const el = document.createElement('div'); el.className = 'pane ' + cls; el.id = 'pane-' + id;
    el.innerHTML = '<div class="chart"></div><div class="legend"></div>';
    $('#panes').appendChild(el);
    const chart = LW.createChart(el.querySelector('.chart'), baseOptions());
    return { id, el, chart, legend: el.querySelector('.legend') };
  }
  const panes = { main: makePane('main', 'main'), rsi: makePane('rsi', 'sub'), macd: makePane('macd', 'sub'), btcd: makePane('btcd', 'sub'), script: makePane('script', 'sub') };
  const main = panes.main.chart;
  main.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.22 } } });

  const candle = main.addCandlestickSeries({ upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down });
  const volume = main.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  const lineOpts = (color, w = 2, extra = {}) => ({ color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });
  const S = {
    sma: main.addLineSeries(lineOpts('#ffd166')),
    ema: main.addLineSeries(lineOpts('#ff9f43')),
    bbU: main.addLineSeries(lineOpts('rgba(77,141,255,0.9)', 1)),
    bbM: main.addLineSeries(lineOpts('rgba(77,141,255,0.5)', 1, { lineStyle: LW.LineStyle.Dashed })),
    bbL: main.addLineSeries(lineOpts('rgba(77,141,255,0.9)', 1)),
    vwap: main.addLineSeries(lineOpts('#ff6bcb', 2, { lineStyle: LW.LineStyle.Dotted })),
    st: main.addLineSeries(lineOpts('#3ddc97', 2, { lineType: LW.LineType.WithSteps })),
    rsi: panes.rsi.chart.addLineSeries(lineOpts('#b388ff', 2, { lastValueVisible: true })),
    macd: panes.macd.chart.addLineSeries(lineOpts('#22d3ee', 2, { lastValueVisible: true })),
    sig: panes.macd.chart.addLineSeries(lineOpts('#ff9f43', 1.5)),
    hist: panes.macd.chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }),
    btcd: panes.btcd.chart.addLineSeries(lineOpts('#f7931a', 2, { lastValueVisible: true, priceLineVisible: true, priceLineStyle: LW.LineStyle.Dotted, priceLineColor: 'rgba(247,147,26,0.5)', priceFormat: { type: 'custom', minMove: 0.01, formatter: (v) => fmt(v, 2) + ' %' } })),
    scriptBase: panes.script.chart.addLineSeries(lineOpts('rgba(0,0,0,0)', 1)), // Platzhalter für gleiche Zeitachse
  };
  [70, 50, 30].forEach((p) => S.rsi.createPriceLine({ price: p, color: p === 50 ? 'rgba(122,133,151,0.35)' : 'rgba(179,136,255,0.45)', lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: false }));
  S.rsi.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
  S.macd.createPriceLine({ price: 0, color: 'rgba(122,133,151,0.35)', lineWidth: 1, lineStyle: LW.LineStyle.Solid, axisLabelVisible: false });
  S.rsi.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
  S.btcd.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0.15 } });
  const paneMainSeries = { main: candle, rsi: S.rsi, macd: S.macd, btcd: S.btcd, get script() { return state.script.series.find((x) => x.chart === panes.script.chart)?.s || S.scriptBase; } };

  function layoutPanes() {
    panes.rsi.el.style.display = state.ind.rsi ? '' : 'none';
    panes.macd.el.style.display = state.ind.macd ? '' : 'none';
    panes.btcd.el.style.display = state.ind.btcd ? '' : 'none';
    panes.script.el.style.display = state.script.outputs.some((o) => o.type === 'panel') ? '' : 'none';
    const visible = Object.values(panes).filter((p) => p.el.style.display !== 'none');
    visible.forEach((p, k) => p.chart.applyOptions({ timeScale: { visible: k === visible.length - 1 } }));
    // Nach dem Ein-/Ausblenden alle Panes auf den Bereich des Hauptcharts setzen
    layoutLock = Date.now();
    const r = main.timeScale().getVisibleLogicalRange();
    requestAnimationFrame(() => { const rr = main.timeScale().getVisibleLogicalRange() || r; if (rr) visible.forEach((p) => p !== panes.main && p.chart.timeScale().setVisibleLogicalRange(rr)); });
  }
  const isVisible = (p) => p.el.style.display !== 'none';

  // Zeitachsen aller Panes koppeln (gleiche logische Indizes dank Platzhalter-Punkten)
  let syncingRange = false, syncingCross = false, layoutLock = 0;
  Object.values(panes).forEach((p) => {
    p.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (syncingRange || !r || !isVisible(p)) return;
      if (p !== panes.main && Date.now() - layoutLock < 400) return; // Größenänderung, keine Nutzeraktion
      syncingRange = true;
      Object.values(panes).forEach((o) => { if (o !== p && isVisible(o)) o.chart.timeScale().setVisibleLogicalRange(r); });
      syncingRange = false;
    });
    p.chart.subscribeCrosshairMove((param) => {
      if (syncingCross) return; syncingCross = true;
      const idx = param.time !== undefined ? state.timeIndex.get(param.time) : undefined;
      Object.values(panes).forEach((o) => {
        if (o === p || !isVisible(o)) return;
        try {
          const d = paneValueAt(o.id, idx);
          if (idx === undefined || !isNum(d)) o.chart.clearCrosshairPosition();
          else o.chart.setCrosshairPosition(d, param.time, paneMainSeries[o.id]);
        } catch (e) { /* Pane ohne Werte an dieser Stelle */ }
      });
      syncingCross = false;
      updateLegends(idx);
      if (p.id === 'main') onMainMove(param);
    });
  });

  // ---------------- Daten laden ----------------
  function setBars(rows) {
    state.bars = rows.map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
    rebuildTimes();
  }
  function rebuildTimes() {
    state.times = state.bars.map((b) => dispTime(b.time));
    state.timeIndex = new Map(state.times.map((t, i) => [t, i]));
  }
  function aggregate(rows, n) { // 1h -> 4h für Aktien: je Handelstag Blöcke zu n Kerzen
    const out = []; let cur = null, day = null, cnt = 0;
    for (const r of rows) {
      const d = Math.floor(r[0] / 86400);
      if (!cur || d !== day || cnt === n) { if (cur) out.push(cur); cur = [...r]; day = d; cnt = 1; continue; }
      cur[2] = Math.max(cur[2], r[2]); cur[3] = Math.min(cur[3], r[3]); cur[4] = r[4]; cur[5] += r[5]; cnt++;
    }
    if (cur) out.push(cur); return out;
  }
  async function load() {
    const token = ++state.loadToken;
    if (state.replay.on) replayStop(false);
    stopFeeds();
    const sym = state.symbol, tf = state.tf;
    state.kind = isStock(sym) ? 'stock' : 'crypto';
    let rows = null, source = '';
    if (state.kind === 'stock') {
      const st = SNAP.aktien[sym] || {};
      if (tf === '1m') { state.tf = '5m'; return load(); }
      rows = tf === '4h' ? aggregate(st['1h'] || [], 4) : st[tf];
      // Yahoo liefert für die laufende Stunde/den laufenden Tag oft eine leere Kerze (Volumen 0, Hoch = Tief) – weglassen
      if (rows) rows = rows.filter((r) => !(r[5] === 0 && r[2] === r[3]));
      source = `Schnappschuss ${SNAP.erstellt || ''}`;
    } else {
      if (!state.test) {
        try {
          const r = await fetchTimeout(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tf}&limit=1000`, 7000);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const k = await r.json();
          rows = k.map((x) => [x[0] / 1000, +x[1], +x[2], +x[3], +x[4], +x[5]]);
          source = 'Binance live';
        } catch (e) { console.warn('REST nicht erreichbar, nutze Schnappschuss', e); }
      }
      if (!rows) {
        rows = SNAP.krypto[sym]?.[tf]; source = state.test ? `Testmodus · Schnappschuss ${SNAP.erstellt || ''}` : `Offline-Fallback · Schnappschuss ${SNAP.erstellt || ''}`;
      }
    }
    if (token !== state.loadToken) return;
    if (!rows || !rows.length) { toast('Keine Daten', `${sym} ${tf} ist weder live noch im Schnappschuss verfügbar. Aktien und Offline-Daten: python3 tools/daten_holen.py ausführen.`); return; }
    state.source = source;
    setBars(rows);
    clearTrends();
    renderAll(true);
    renderToolbarState();
    startFeeds();
  }

  // ---------------- Darstellung ----------------
  const toLine = (arr) => arr.map((v, i) => (isNum(v) ? { time: state.times[i], value: v } : { time: state.times[i] }));
  let calc = {};
  function compute() {
    const close = state.bars.map((b) => b.close);
    calc = {
      sma: I.sma(close, 50), ema: I.ema(close, 21), bb: I.bollinger(close, 20, 2),
      vwap: I.vwap(state.bars, state.tf === '1d' ? (t) => { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); } : undefined),
      rsi: I.rsi(close, 14), macd: I.macd(close, 12, 26, 9), st: I.supertrend(state.bars, 10, 3),
      btcd: I.alignSeries(state.dom.points, state.bars.map((b) => b.time), tfSec()),
    };
  }
  // SuperTrend: Linie grün im Aufwärtstrend, rot im Abwärtstrend (Farbe je Punkt)
  const stPoint = (i) => (isNum(calc.st.line[i]) ? { time: state.times[i], value: calc.st.line[i], color: calc.st.dir[i] === 1 ? C.up : C.down } : { time: state.times[i] });
  const histColor = (h, prev) => (h >= 0 ? (isNum(prev) && h < prev ? 'rgba(61,220,151,0.45)' : 'rgba(61,220,151,0.9)') : (isNum(prev) && h > prev ? 'rgba(255,107,122,0.45)' : 'rgba(255,107,122,0.9)'));
  const volColor = (b) => (b.close >= b.open ? 'rgba(61,220,151,0.32)' : 'rgba(255,107,122,0.32)');

  function renderAll(fit) {
    const p = precisionFor(state.bars[state.bars.length - 1].close);
    const pf = { type: 'price', precision: p, minMove: 1 / 10 ** p };
    candle.applyOptions({ priceFormat: pf });
    [S.sma, S.ema, S.bbU, S.bbM, S.bbL, S.vwap].forEach((s) => s.applyOptions({ priceFormat: pf }));
    candle.setData(state.bars.map((b, i) => ({ time: state.times[i], open: b.open, high: b.high, low: b.low, close: b.close })));
    volume.setData(state.bars.map((b, i) => ({ time: state.times[i], value: b.volume, color: volColor(b) })));
    S.scriptBase.setData(state.times.map((t) => ({ time: t })));
    compute();
    S.sma.setData(toLine(calc.sma)); S.ema.setData(toLine(calc.ema));
    S.bbU.setData(toLine(calc.bb.upper)); S.bbM.setData(toLine(calc.bb.mid)); S.bbL.setData(toLine(calc.bb.lower));
    S.vwap.setData(toLine(calc.vwap)); S.rsi.setData(toLine(calc.rsi));
    S.st.setData(state.bars.map((_, i) => stPoint(i)));
    S.macd.setData(toLine(calc.macd.macd)); S.sig.setData(toLine(calc.macd.signal));
    S.hist.setData(calc.macd.hist.map((h, i) => (isNum(h) ? { time: state.times[i], value: h, color: histColor(h, calc.macd.hist[i - 1]) } : { time: state.times[i] })));
    S.btcd.setData(toLine(calc.btcd));
    applyIndicatorVisibility();
    runScript(false);
    layoutPanes();
    if (fit) {
      const n = state.bars.length;
      main.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 6 });
      // Preisachsen wieder automatisch skalieren: nach Ziehen/Zoomen der Achse bleibt sonst der alte Bereich stehen
      Object.values(panes).forEach((p) => p.chart.priceScale('right').applyOptions({ autoScale: true }));
    }
    state.lastPrice = state.bars[state.bars.length - 1].close;
    updateHeader(false); updateLegends(); updateStatus();
  }
  function applyIndicatorVisibility() {
    S.sma.applyOptions({ visible: state.ind.sma }); S.ema.applyOptions({ visible: state.ind.ema });
    [S.bbU, S.bbM, S.bbL].forEach((s) => s.applyOptions({ visible: state.ind.bb }));
    S.vwap.applyOptions({ visible: state.ind.vwap });
    S.st.applyOptions({ visible: state.ind.st });
    if (state.ind.btcd) ensureDominance();
  }
  // Live: nur die letzte Kerze neu zeichnen (schnell), Indikatoren komplett neu rechnen (500–1000 Werte sind billig)
  function renderLast() {
    const i = state.bars.length - 1, b = state.bars[i], t = state.times[i];
    candle.update({ time: t, open: b.open, high: b.high, low: b.low, close: b.close });
    volume.update({ time: t, value: b.volume, color: volColor(b) });
    S.scriptBase.update({ time: t });
    compute();
    const up = (s, arr) => s.update(isNum(arr[i]) ? { time: t, value: arr[i] } : { time: t });
    up(S.sma, calc.sma); up(S.ema, calc.ema); up(S.bbU, calc.bb.upper); up(S.bbM, calc.bb.mid); up(S.bbL, calc.bb.lower);
    up(S.vwap, calc.vwap); up(S.rsi, calc.rsi); up(S.macd, calc.macd.macd); up(S.sig, calc.macd.signal); up(S.btcd, calc.btcd);
    S.st.update(stPoint(i));
    const h = calc.macd.hist[i]; S.hist.update(isNum(h) ? { time: t, value: h, color: histColor(h, calc.macd.hist[i - 1]) } : { time: t });
    scheduleScript();
    updateLegends(hoverIdx);
  }

  function paneValueAt(id, idx) {
    if (id === 'main') return state.bars[idx]?.close;
    if (id === 'rsi') return calc.rsi?.[idx];
    if (id === 'macd') return calc.macd?.macd[idx];
    if (id === 'btcd') return calc.btcd?.[idx];
    const o = state.script.outputs.find((x) => x.type === 'panel'); return o ? o.values[idx] : null;
  }

  // Legende oben links (Fadenkreuz-Werte)
  let hoverIdx;
  function updateLegends(idx) {
    hoverIdx = idx;
    const n = state.bars.length; if (!n) return;
    const i = idx === undefined ? n - 1 : idx; const b = state.bars[i]; if (!b) return;
    const d = precisionFor(b.close);
    const ch = b.close - b.open, chp = (ch / b.open) * 100, cls = ch >= 0 ? 'pos' : 'neg';
    const tf = TFS.find((t) => t.id === state.tf).label;
    const v = (x) => fmt(x, d);
    let html = `<div class="title">${state.symbol} · ${tf}<span class="src">${state.source}</span></div>
      <div class="row"><span class="k">E</span><span class="v ${cls}">${v(b.open)}</span><span class="k">H</span><span class="v ${cls}">${v(b.high)}</span><span class="k">T</span><span class="v ${cls}">${v(b.low)}</span><span class="k">S</span><span class="v ${cls}">${v(b.close)}</span><span class="v ${cls}">${ch >= 0 ? '+' : ''}${v(ch)} (${ch >= 0 ? '+' : ''}${fmt(chp, 2)} %)</span><span class="k">Vol</span><span class="v">${fmtVol(b.volume)}</span></div>`;
    const ind = (name, color, val) => `<span class="ind"><b style="color:${color}">${name}</b> <span style="color:${color}">${val}</span></span>`;
    if (state.ind.sma) html += ind('SMA 50', '#ffd166', v(calc.sma[i]));
    if (state.ind.ema) html += ind('EMA 21', '#ff9f43', v(calc.ema[i]));
    if (state.ind.bb) html += ind('BB 20 2', '#4d8dff', `${v(calc.bb.upper[i])} · ${v(calc.bb.mid[i])} · ${v(calc.bb.lower[i])}`);
    if (state.ind.vwap) html += ind('VWAP', '#ff6bcb', v(calc.vwap[i]));
    if (state.ind.st) html += ind('SuperTrend 10 3', calc.st.dir[i] === -1 ? C.down : C.up, `${v(calc.st.line[i])} ${calc.st.dir[i] === 1 ? '▲' : calc.st.dir[i] === -1 ? '▼' : ''}`);
    state.script.outputs.filter((o) => o.type === 'plot').forEach((o) => { html += ind('ƒ ' + esc(o.title), o.color, v(o.values[i])); });
    panes.main.legend.innerHTML = html;
    panes.rsi.legend.innerHTML = ind('RSI 14', '#b388ff', fmt(calc.rsi[i], 2));
    panes.macd.legend.innerHTML = ind('MACD 12 26 9', '#22d3ee', `${fmt(calc.macd.macd[i], d)} <span style="color:#ff9f43">${fmt(calc.macd.signal[i], d)}</span> <span style="color:${(calc.macd.hist[i] || 0) >= 0 ? C.up : C.down}">${fmt(calc.macd.hist[i], d)}</span>`);
    panes.btcd.legend.innerHTML = ind('BTC.D', '#f7931a', fmt(calc.btcd?.[i], 2) + ' %') + `<span class="src">${esc(state.dom.source || (state.dom.loading ? 'lädt …' : 'keine Daten'))}${state.dom.liveUsed ? ' · letzter Punkt live (CoinGecko)' : ''}</span>`;
    panes.script.legend.innerHTML = state.script.outputs.filter((o) => o.type === 'panel').map((o) => ind('ƒ ' + esc(o.title), o.color, fmt(o.values[i], 2))).join('');
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function updateHeader(flash) {
    const el = $('#lastPrice'), p = state.lastPrice;
    el.textContent = fmt(p, precisionFor(p));
    if (flash && isNum(state.prevTickPrice) && p !== state.prevTickPrice) {
      el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth;
      el.classList.add(p > state.prevTickPrice ? 'flash-up' : 'flash-down');
      clearTimeout(updateHeader.t); updateHeader.t = setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 260);
    }
    // Veränderung zum Vortag: live aus dem 24h-Ticker, sonst aus den Tageskerzen des Schnappschusses
    let ref = (state.test ? null : state.watch[state.symbol]?.open) ?? watchData(state.symbol)?.open;
    if (!isNum(ref)) { const n = state.bars.length; ref = state.bars[Math.max(0, n - 2)]?.close; }
    const ch = ((p - ref) / ref) * 100;
    const c = $('#lastChange'); c.textContent = `${ch >= 0 ? '+' : ''}${fmt(ch, 2)} %`; c.className = ch >= 0 ? 'pos' : 'neg';
    document.title = `${state.symbol} ${fmt(p, precisionFor(p))} · iC Charts`;
  }
  function setConn(kind, text) { const c = $('#conn'); c.className = 'conn ' + kind; c.querySelector('span').textContent = text; }
  function updateStatus() {
    $('#srcInfo').textContent = `Quelle: ${state.source} · ${state.bars.length} Kerzen`;
    const age = state.lastMsg ? ((Date.now() - state.lastMsg) / 1000).toFixed(1).replace('.', ',') : '–';
    $('#tickInfo').textContent = state.ticks ? `Ticks: ${state.ticks} · letzte Nachricht vor ${age} s` : '';
  }
  setInterval(updateStatus, 1000);

  // ---------------- Live-Kurse ----------------
  function onTick(t, o, h, l, c, v) { // t = Kerzen-Startzeit (Unix-Sekunden)
    const bars = state.bars, last = bars[bars.length - 1];
    if (t < last.time) return;
    if (t === last.time) Object.assign(last, { open: o, high: h, low: l, close: c, volume: v });
    else { bars.push({ time: t, open: o, high: h, low: l, close: c, volume: v }); state.times.push(dispTime(t)); state.timeIndex.set(dispTime(t), bars.length - 1); }
    state.prevTickPrice = state.lastPrice; state.lastPrice = c; state.ticks++; state.lastMsg = Date.now();
    renderLast(); updateHeader(true); checkAlarms(state.prevTickPrice, c);
  }
  function startFeeds() {
    state.ticks = 0;
    if (state.kind === 'crypto' && state.source === 'Binance live') { connectKline(); startBook(); }
    else if (state.test || state.kind === 'crypto') startSim(state.test ? 'Testmodus · simulierte Ticks' : 'Offline · simulierte Ticks');
    else setConn('off', 'Schnappschuss (kein Live-Kurs)');
  }
  // Eine noch verbindende WebSocket erst nach dem Öffnen schließen (sonst warnt der Browser)
  const closeWs = (ws) => { ws.onclose = null; ws.onmessage = null; if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close(); else ws.close(); };
  function stopFeeds() {
    if (state.ws) { closeWs(state.ws); state.ws = null; }
    if (state.sim) { clearInterval(state.sim); state.sim = null; }
    stopBook();
  }

  // ---------------- Bitcoin-Dominanz (BTC.D) ----------------
  // Historie: CoinMarketCap-Website-Endpunkt ohne Schlüssel, aber ohne CORS – daher über den Agent-Server
  // (/api/dominanz) oder aus dem Schnappschuss. Live-Punkt: CoinGecko /global (CORS frei), nur wenn die
  // Historie älter als zwei Stunden ist, weil CoinGecko ein etwas anderes Coin-Universum zählt.
  const DOM_LIVE_URL = 'https://api.coingecko.com/api/v3/global';
  function loadDominance() {
    if (state.dom.loading) return state.dom.loading;
    state.dom.loading = (async () => {
      let hist = null, src = '';
      if (!state.test && location.protocol.startsWith('http')) {
        try {
          const r = await fetchTimeout('api/dominanz', 10000);
          if (r.ok) { hist = await r.json(); src = 'CoinMarketCap über Server'; }
        } catch (e) { /* kein Agent-Server, Schnappschuss nehmen */ }
      }
      if (!hist && SNAP.dominanz) { hist = SNAP.dominanz; src = `Schnappschuss ${SNAP.dominanz.stand || ''}`; }
      state.dom.hist = hist; state.dom.source = src;
      applyDominance();
    })();
    return state.dom.loading;
  }
  async function pollDominanceLive() {
    if (state.test || Date.now() - state.dom.lastLive < 60e3) return;
    state.dom.lastLive = Date.now();
    try {
      const r = await fetchTimeout(DOM_LIVE_URL, 7000); const j = await r.json();
      const v = j?.data?.market_cap_percentage?.btc;
      if (isNum(v)) { state.dom.live = [Math.floor(Date.now() / 1000), Math.round(v * 100) / 100]; applyDominance(); }
    } catch (e) { /* kein Live-Wert, Historie reicht */ }
  }
  function applyDominance() {
    const h = state.dom.hist || {}, last = (h.stunden || h.tage || []).slice(-1)[0];
    state.dom.liveUsed = !!(state.dom.live && (!last || state.dom.live[0] - last[0] > 2 * 3600));
    state.dom.points = I.mergeSeries([h.tage, h.stunden, state.dom.liveUsed ? [state.dom.live] : []]);
    if (!state.bars.length) return;
    calc.btcd = I.alignSeries(state.dom.points, state.bars.map((b) => b.time), tfSec());
    S.btcd.setData(toLine(calc.btcd));
    updateLegends(hoverIdx);
  }
  function ensureDominance() { loadDominance(); pollDominanceLive(); }
  setInterval(() => { if (state.ind.btcd) pollDominanceLive(); }, 5 * 60e3);

  // ---------------- Orderbuch (Binance Partial Book Depth, 10 Stufen je Seite, 1 s) ----------------
  function stopBook() { if (state.wsBook) { closeWs(state.wsBook); state.wsBook = null; } $('#bookCard').style.display = 'none'; }
  function startBook() {
    stopBook();
    try {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${state.symbol.toLowerCase()}@depth10`);
      state.wsBook = ws;
      ws.onmessage = (ev) => { const d = JSON.parse(ev.data); if (d.bids && d.asks) { $('#bookCard').style.display = ''; renderBook(d.bids, d.asks); } };
      ws.onerror = () => {};
    } catch (e) { /* offline */ }
  }
  function renderBook(bids, asks) {
    const p = precisionFor(state.lastPrice || +bids[0][0]);
    const lv = (arr) => arr.map(([pr, q]) => [+pr, +q]);
    const B = lv(bids).slice(0, 7), A = lv(asks).slice(0, 7);
    const maxCum = Math.max(B.reduce((s, x) => s + x[1], 0), A.reduce((s, x) => s + x[1], 0)) || 1;
    const rows = (arr, reverse) => {
      let cum = 0; const out = arr.map(([pr, q]) => { cum += q; return `<div class="row"><i style="width:${(cum / maxCum) * 100}%"></i><span>${fmt(pr, p)}</span><span class="q">${fmt(q, q >= 100 ? 1 : q >= 1 ? 3 : 4)}</span></div>`; });
      return (reverse ? out.reverse() : out).join('');
    };
    $('#book .asks').innerHTML = rows(A, true);
    $('#book .bids').innerHTML = rows(B, false);
    const spread = A[0][0] - B[0][0];
    $('#book .spread').innerHTML = `<span>Spread</span><b>${fmt(spread, p)}</b><span>${fmt((spread / A[0][0]) * 100, 3)} %</span>`;
  }

  // ---------------- Replay: die Vergangenheit Kerze für Kerze abspielen ----------------
  const R = state.replay;
  const SUB = [0.35, 0.7, 1]; // jede Kerze wächst in drei Schritten (Eröffnung → Schluss)
  function replayStart() {
    if (!state.bars.length || R.on) return;
    stopFeeds();
    R.on = true; R.full = state.bars.map((b) => ({ ...b })); R.pos = Math.max(60, R.full.length - 150); R.sub = 0;
    state.bars = R.full.slice(0, R.pos); rebuildTimes();
    state.prevTickPrice = null; state.lastPrice = state.bars[state.bars.length - 1].close;
    clearScriptNotified(); renderAll(true); setConn('sim', 'Replay · ' + state.source);
    $('#replayBar').style.display = 'flex'; $('#btnReplay').classList.add('on');
    $('#rpSlider').max = R.full.length; replayUpdateUi(); replayPlay(true);
    toast('Replay gestartet', `${state.symbol} ${state.tf}: Kerze ${R.pos} von ${R.full.length}. Leertaste = Pause, → = Schritt.`, 'signal');
  }
  function replayTick() {
    if (R.pos >= R.full.length) { replayPlay(false); toast('Replay zu Ende', 'Alle Kerzen abgespielt.', 'signal'); return; }
    const b = R.full[R.pos], f = SUB[R.sub];
    const close = b.open + (b.close - b.open) * f;
    const high = Math.max(b.open, close) + (b.high - Math.max(b.open, b.close)) * f;
    const low = Math.min(b.open, close) - (Math.min(b.open, b.close) - b.low) * f;
    onTick(b.time, b.open, high, low, close, b.volume * f);
    if (++R.sub >= SUB.length) { R.sub = 0; R.pos++; }
    replayUpdateUi();
  }
  function replayPlay(on) {
    R.playing = on; clearInterval(R.timer); R.timer = null;
    if (on) R.timer = setInterval(replayTick, 450 / (+$('#rpSpeed').value || 1));
    $('#rpPlay').textContent = on ? '⏸' : '▶';
  }
  function replaySeek(pos) {
    pos = Math.max(60, Math.min(R.full.length, Math.round(pos)));
    replayPlay(false); R.pos = pos; R.sub = 0;
    state.bars = R.full.slice(0, pos); rebuildTimes();
    state.prevTickPrice = null; state.lastPrice = state.bars[state.bars.length - 1].close;
    clearScriptNotified(); renderAll(true); replayUpdateUi();
  }
  function replayUpdateUi() {
    const b = state.bars[state.bars.length - 1];
    $('#rpPos').textContent = `${R.pos} / ${R.full.length} · ${new Date(b.time * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    $('#rpSlider').value = R.pos;
  }
  function replayStop(reload = true) {
    if (!R.on) return;
    replayPlay(false); R.on = false; R.full = null;
    $('#replayBar').style.display = 'none'; $('#btnReplay').classList.remove('on');
    if (reload) load();
  }
  $('#btnReplay').onclick = () => (R.on ? replayStop() : replayStart());
  $('#rpPlay').onclick = () => replayPlay(!R.playing);
  $('#rpStep').onclick = () => { replayPlay(false); for (let k = 0; k < SUB.length; k++) replayTick(); };
  $('#rpStop').onclick = () => replayStop();
  $('#rpSpeed').onchange = () => { if (R.playing) replayPlay(true); };
  $('#rpSlider').oninput = (e) => replaySeek(+e.target.value);
  function connectKline(attempt = 0) {
    setConn('', 'verbinde…');
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${state.symbol.toLowerCase()}@kline_${state.tf}`);
    state.ws = ws; let got = false;
    const guard = setTimeout(() => { if (!got) { closeWs(ws); fallback(); } }, 9000);
    const fallback = () => { if (state.ws !== ws) return; state.ws = null; if (attempt < 2) setTimeout(() => connectKline(attempt + 1), 1500); else startSim('WebSocket nicht erreichbar · simuliert'); };
    ws.onmessage = (ev) => {
      if (!got) { got = true; clearTimeout(guard); setConn('live', 'Live · Binance WebSocket'); }
      const k = JSON.parse(ev.data).k; if (!k) return;
      onTick(k.t / 1000, +k.o, +k.h, +k.l, +k.c, +k.v);
    };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(guard); fallback(); };
  }
  // Simulation: Zufallsbewegung auf Basis der zuletzt typischen Schwankung.
  // Im Testmodus leicht zum nächsten offenen Alarm gezogen, damit die Demo sicher auslöst.
  function startSim(label) {
    if (state.sim) clearInterval(state.sim);
    setConn('sim', label);
    const bars = state.bars, n = bars.length;
    const vol = bars.slice(-50).reduce((s, b) => s + Math.abs(b.close - b.open), 0) / Math.min(50, n) || bars[n - 1].close * 0.002;
    let k = 0, t = bars[n - 1].time;
    state.sim = setInterval(() => {
      const last = state.bars[state.bars.length - 1];
      let p = last.close;
      const open = state.alarms.filter((a) => !a.fired).sort((a, b) => Math.abs(a.price - p) - Math.abs(b.price - p))[0];
      const pull = open ? Math.sign(open.price - p) * vol * 0.06 : 0;
      p = Math.max(p + (Math.random() - 0.5) * vol * 0.35 + pull, 1e-9);
      if (++k % 25 === 0) { t += tfSec(); onTick(t, last.close, Math.max(last.close, p), Math.min(last.close, p), p, last.volume * 0.05); return; }
      onTick(last.time, last.open, Math.max(last.high, p), Math.min(last.low, p), p, last.volume + Math.random() * last.volume * 0.01);
    }, 600);
  }
  // Beobachtungsliste: 24h-Werte per REST, dann Mini-Ticker per WebSocket
  async function startWatch() {
    renderWatch();
    if (state.test) return;
    try {
      const r = await fetchTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(CRYPTO))}`, 6000);
      (await r.json()).forEach((x) => { state.watch[x.symbol] = { price: +x.lastPrice, open: +x.openPrice }; });
      renderWatch(); updateHeader(false);
    } catch (e) { /* offline */ }
    try {
      const ws = new WebSocket('wss://stream.binance.com:9443/stream?streams=' + CRYPTO.map((s) => s.toLowerCase() + '@miniTicker').join('/'));
      ws.onmessage = (ev) => { const d = JSON.parse(ev.data).data; state.watch[d.s] = { price: +d.c, open: +d.o }; renderWatchRow(d.s); };
      state.wsWatch = ws;
    } catch (e) { /* offline */ }
  }
  function watchData(s) {
    if (state.watch[s]) return state.watch[s];
    const rows = isStock(s) ? SNAP.aktien[s]?.['1d'] : SNAP.krypto[s]?.['1d'];
    if (!rows || rows.length < 2) return null;
    return { price: rows[rows.length - 1][4], open: rows[rows.length - 2][4], snap: true };
  }
  function renderWatch() {
    const tape = $('#tape'); tape.innerHTML = '';
    [...CRYPTO, ...STOCKS].forEach((s) => {
      const b = document.createElement('button'); b.className = 'chip'; b.dataset.sym = s;
      b.innerHTML = `<span class="n">${s.replace('USDT', '')}<small>${isStock(s) ? (s === 'SAP' ? 'XETRA' : 'NASDAQ') : 'USDT'}</small></span><span class="p"></span><span class="c"></span>`;
      b.onclick = () => switchSymbol(s); tape.appendChild(b); renderWatchRow(s);
    });
  }
  function renderWatchRow(s) {
    const el = document.querySelector(`#tape .chip[data-sym="${s}"]`); if (!el) return;
    el.classList.toggle('sel', s === state.symbol);
    const d = watchData(s); if (!d) return;
    const pEl = el.querySelector('.p'), old = pEl.dataset.v ? +pEl.dataset.v : null;
    pEl.textContent = fmt(d.price, precisionFor(d.price)); pEl.dataset.v = d.price;
    if (old !== null && old !== d.price) { pEl.style.color = d.price > old ? C.up : C.down; setTimeout(() => (pEl.style.color = ''), 300); }
    const ch = ((d.price - d.open) / d.open) * 100; const c = el.querySelector('.c');
    c.textContent = `${ch >= 0 ? '+' : ''}${fmt(ch, 2)} %`; c.className = 'c ' + (ch >= 0 ? 'pos' : 'neg');
  }

  // ---------------- Zeichenwerkzeuge & Alarme ----------------
  const hints = { hline: 'Klick setzt eine horizontale Linie', alarm: 'Klick setzt einen Preisalarm', trend: 'Trendlinie: Startpunkt klicken',
    fib: 'Fibonacci: ersten Punkt klicken (Hoch oder Tief)', pos: 'Position: Einstieg klicken' };
  // Eigene Zeichenebene (drawings.js) für Fibonacci und Positionen – hängt an der Kerzenserie
  const layer = new window.Drawings.Layer({ up: C.up, down: C.down, accent: C.accent, fmt: (v) => fmtP(v) });
  candle.attachPrimitive(layer);
  let drawPts = []; // gesammelte Klicks des laufenden Werkzeugs
  function setTool(t) {
    state.tool = t; state.trendStart = null; drawPts = []; layer.setPending(null); removePreview();
    document.querySelectorAll('#toolbar [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    const h = $('#toolHint'); h.textContent = hints[t] || ''; h.style.display = hints[t] ? 'block' : 'none';
  }
  function pointFromParam(param) {
    if (!param.point) return null;
    const price = candle.coordinateToPrice(param.point.y);
    let idx = param.logical !== undefined ? Math.round(param.logical) : undefined;
    if (!isNum(price) || idx === undefined) return null;
    idx = Math.max(0, Math.min(state.bars.length - 1, idx));
    return { idx, time: state.times[idx], price };
  }
  // Klicks selbst erkennen (Zeiger runter/hoch ohne Ziehen) – unabhängig von der Klick-Logik der Bibliothek,
  // die schnelle Folgeklicks als Doppelklick schluckt. Koordinaten werden in Zeitindex und Preis umgerechnet.
  let downAt = null;
  const mainEl = panes.main.el.querySelector('.chart');
  mainEl.addEventListener('pointerdown', (e) => { if (e.button === 0) downAt = { x: e.clientX, y: e.clientY }; }, true);
  mainEl.addEventListener('pointerup', (e) => {
    if (!downAt || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y); downAt = null;
    if (moved > 4 || state.tool === 'cross') return;
    const r = mainEl.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x > r.width - main.priceScale('right').width()) return; // Klick auf die Preisachse ignorieren
    handleChartClick({ point: { x, y }, logical: main.timeScale().coordinateToLogical(x) ?? undefined });
  }, true);
  function handleChartClick(param) {
    const pt = pointFromParam(param); if (!pt) return;
    if (state.tool === 'hline') { addHLine(pt.price); setTool('cross'); }
    else if (state.tool === 'alarm') { addAlarm(pt.price); setTool('cross'); }
    else if (state.tool === 'trend') {
      if (!state.trendStart) { state.trendStart = pt; $('#toolHint').textContent = 'Trendlinie: Endpunkt klicken'; }
      else { addTrend(state.trendStart, pt); setTool('cross'); }
    }
    else if (state.tool === 'fib') {
      drawPts.push(pt);
      if (drawPts.length === 1) $('#toolHint').textContent = 'Fibonacci: zweiten Punkt klicken';
      else { layer.add(shapeFrom('fib', drawPts)); const s = layer.shapes[layer.shapes.length - 1]; toast('Fibonacci gesetzt', `Strecke ${fmtP(Math.min(s.a.price, s.b.price))} – ${fmtP(Math.max(s.a.price, s.b.price))}`, 'signal'); setTool('cross'); }
    }
    else if (state.tool === 'pos') {
      drawPts.push(pt);
      if (drawPts.length === 1) $('#toolHint').textContent = 'Ziel klicken (über dem Einstieg = Long, darunter = Short)';
      else if (drawPts.length === 2) $('#toolHint').textContent = 'Stop klicken';
      else {
        const s = shapeFrom('pos', drawPts); layer.add(s);
        const crv = Math.abs(s.target.price - s.entry.price) / Math.abs(s.entry.price - s.stop.price);
        toast(`${s.target.price >= s.entry.price ? 'Long' : 'Short'} eingezeichnet`, `Einstieg ${fmtP(s.entry.price)} · Ziel ${fmtP(s.target.price)} · Stop ${fmtP(s.stop.price)} · CRV 1 : ${fmt(crv, 2)}`, 'signal');
        setTool('cross');
      }
    }
  }
  function shapeFrom(type, pts) {
    if (type === 'fib') return { type, a: pts[0], b: pts[1] };
    return { type, entry: pts[0], target: pts[1], stop: pts[2], idx0: pts[0].idx, idx1: Math.max(...pts.map((p) => p.idx)) };
  }
  function undoDrawing() {
    if (layer.shapes.length) { layer.removeLast(); return; }
    const t = state.trends.pop(); if (t) { main.removeSeries(t); return; }
    const h = state.hlines.pop(); if (h) candle.removePriceLine(h);
  }
  let preview = null;
  function removePreview() { previewPt = null; if (preview) { try { main.removeSeries(preview); } catch (e) { /* schon entfernt */ } preview = null; } }
  // Vorschau der Trendlinie: außerhalb des Crosshair-Ereignisses zeichnen (sonst löst setData neue Ereignisse aus)
  let previewPt = null, previewQueued = false;
  let pendQueued = false;
  function onMainMove(param) {
    if ((state.tool === 'fib' || state.tool === 'pos') && drawPts.length) {
      const pt = pointFromParam(param); if (!pt || pendQueued) return;
      pendQueued = true; requestAnimationFrame(() => { pendQueued = false; if (drawPts.length) layer.setPending(shapeFrom(state.tool, [...drawPts, pt, pt].slice(0, state.tool === 'fib' ? 2 : 3))); });
      return;
    }
    if (state.tool !== 'trend' || !state.trendStart) return;
    const pt = pointFromParam(param); if (!pt || pt.idx === state.trendStart.idx) return;
    if (previewPt && previewPt.idx === pt.idx && Math.abs(previewPt.price - pt.price) < 1e-12) return;
    previewPt = pt;
    if (previewQueued) return; previewQueued = true;
    requestAnimationFrame(() => {
      previewQueued = false;
      if (state.tool !== 'trend' || !state.trendStart || !previewPt) return;
      if (!preview) preview = main.addLineSeries(lineOpts('rgba(245,185,66,0.6)', 2, { lineStyle: LW.LineStyle.Dashed, autoscaleInfoProvider: () => null, lastValueVisible: false }));
      preview.setData(trendPoints(state.trendStart, previewPt));
    });
  }
  const trendPoints = (a, b) => [a, b].sort((x, y) => x.idx - y.idx).map((p) => ({ time: p.time, value: p.price }));
  function addTrend(a, b) {
    removePreview(); if (a.idx === b.idx) return;
    const s = main.addLineSeries(lineOpts(C.accent, 2, { autoscaleInfoProvider: () => null }));
    s.setData(trendPoints(a, b));
    s.setMarkers(trendPoints(a, b).map((p) => ({ time: p.time, position: 'inBar', shape: 'circle', color: C.accent, size: 0.6 })));
    state.trends.push(s);
  }
  function clearTrends() { state.trends.forEach((s) => main.removeSeries(s)); state.trends = []; removePreview(); state.trendStart = null; }
  function addHLine(price) {
    state.hlines.push(candle.createPriceLine({ price, color: '#8fb3ff', lineWidth: 1, lineStyle: LW.LineStyle.Solid, axisLabelVisible: true, title: '' }));
  }
  function addAlarm(price) {
    const a = { price, fired: false, dir: price > state.lastPrice ? 'steigt über' : 'fällt unter' };
    a.line = candle.createPriceLine({ price, color: C.warn, lineWidth: 2, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: 'ALARM' });
    state.alarms.push(a); renderAlarms();
    toast('Alarm gesetzt', `${state.symbol} ${a.dir} ${fmtP(price)}`, 'signal');
  }
  function checkAlarms(prev, now) {
    if (!isNum(prev)) return;
    state.alarms.forEach((a) => {
      if (a.fired) return;
      if ((prev < a.price && now >= a.price) || (prev > a.price && now <= a.price)) {
        a.fired = true; a.at = new Date();
        a.line.applyOptions({ color: now >= prev ? C.up : C.down, lineStyle: LW.LineStyle.Solid, title: 'AUSGELÖST' });
        toast(`Alarm ausgelöst: ${state.symbol}`, `Kurs ${fmtP(now)} hat ${fmtP(a.price)} gekreuzt (${a.at.toLocaleTimeString('de-DE')})`);
        beep(); const st = $('#stage'); st.classList.remove('flash'); void st.offsetWidth; st.classList.add('flash');
        renderAlarms();
      }
    });
  }
  function renderAlarms() {
    const ul = $('#alarmList'); ul.innerHTML = '';
    $('#alarmCount').textContent = state.alarms.length;
    if (!state.alarms.length) { ul.innerHTML = '<li class="muted">Glocke links wählen und in den Chart klicken.</li>'; return; }
    state.alarms.forEach((a, k) => {
      const li = document.createElement('li'); li.className = a.fired ? 'fired' : '';
      li.innerHTML = `<span>${a.fired ? '●' : '○'}</span><span class="p">${state.symbol} ${a.dir} ${fmtP(a.price)}${a.fired ? ' · ausgelöst ' + a.at.toLocaleTimeString('de-DE') : ''}</span><button title="Löschen">✕</button>`;
      li.querySelector('button').onclick = () => { candle.removePriceLine(a.line); state.alarms.splice(k, 1); renderAlarms(); };
      ul.appendChild(li);
    });
  }
  function clearDrawings() {
    clearTrends(); layer.clear();
    state.hlines.forEach((l) => candle.removePriceLine(l)); state.hlines = [];
    state.alarms.forEach((a) => candle.removePriceLine(a.line)); state.alarms = []; renderAlarms();
  }

  // ---------------- Mini-Script ----------------
  const code = $('#code'), hl = $('#hl');
  const FN = new Set(['sma', 'ema', 'rma', 'rsi', 'stdev', 'highest', 'lowest', 'bbupper', 'bblower', 'macd', 'macdsignal', 'macdhist', 'vwap', 'atr', 'stoch', 'stochd', 'supertrend', 'crossover', 'crossunder', 'change', 'abs', 'max', 'min']);
  const ACT = new Set(['plot', 'panel', 'alert', 'hline', 'buy', 'sell']);
  const BUILTIN = new Set(['close', 'open', 'high', 'low', 'volume', 'hl2', 'hlc3']);
  function highlight() {
    const src = code.value;
    const re = /(\/\/[^\n]*|#[^\n]*)|("[^"\n]*"?|'[^'\n]*'?)|(\b\d*\.?\d+\b)|([A-Za-z_äöüÄÖÜß][\wäöüÄÖÜß]*)|([^\w\s])|(\s+)/g;
    let out = '', m;
    while ((m = re.exec(src))) {
      const t = esc(m[0]);
      if (m[1]) out += `<span class="hl-com">${t}</span>`;
      else if (m[2]) out += `<span class="hl-str">${t}</span>`;
      else if (m[3]) out += `<span class="hl-num">${t}</span>`;
      else if (m[4]) { const w = m[4].toLowerCase(); out += ACT.has(w) ? `<span class="hl-act">${t}</span>` : FN.has(w) ? `<span class="hl-fn">${t}</span>` : BUILTIN.has(w) ? `<span class="hl-var">${t}</span>` : ['and', 'or', 'not'].includes(w) ? `<span class="hl-op">${t}</span>` : t; }
      else if (m[5]) out += `<span class="hl-op">${t}</span>`;
      else out += t;
    }
    hl.innerHTML = out + '\n';
    hl.scrollTop = code.scrollTop;
  }
  code.addEventListener('input', highlight);
  code.addEventListener('scroll', () => (hl.scrollTop = code.scrollTop));
  code.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); applyScript(); }
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
  });
  function clearScriptVisuals() {
    state.script.series.forEach(({ chart, s }) => chart.removeSeries(s)); state.script.series = [];
    state.script.lines.forEach((l) => candle.removePriceLine(l)); state.script.lines = [];
    candle.setMarkers([]);
  }
  const clearScriptNotified = () => { state.script.notified = new Set(); };
  function applyScript() { state.script.text = code.value; clearScriptNotified(); store.set('script', code.value); runScript(true); layoutPanes(); updateLegends(hoverIdx); }
  let scriptTimer = null;
  function scheduleScript() {
    if (!state.script.text) return;
    const o = state.script.outputs[0];
    if (o && o.values.length !== state.bars.length) { clearTimeout(scriptTimer); scriptTimer = null; runScript(false, true); updateLegends(hoverIdx); return; }
    if (scriptTimer) return;
    scriptTimer = setTimeout(() => { scriptTimer = null; runScript(false, true); updateLegends(hoverIdx); }, 800);
  }
  function runScript(report, live) {
    const out = $('#scriptOut');
    const btEl = $('#btStats');
    if (!state.script.text.trim()) { clearScriptVisuals(); state.script.outputs = []; state.script.bt = null; btEl.style.display = 'none'; return; }
    const t0 = performance.now();
    let outputs;
    try { outputs = window.MiniScript.run(state.script.text, state.bars); }
    catch (e) { if (report) out.innerHTML = `<span class="err">✕ ${esc(e.message)}</span>`; return; }
    // Backtest, sobald buy() und sell() vorkommen: Kapitalkurve und Buy & Hold als eigenes Panel
    const buys = outputs.filter((o) => o.type === 'buy'), sells = outputs.filter((o) => o.type === 'sell');
    let bt = null;
    if (buys.length || sells.length) {
      const any = (arr, i) => arr.some((o) => o.values[i]);
      const n = state.bars.length, bs = Array.from({ length: n }, (_, i) => any(buys, i)), ss = Array.from({ length: n }, (_, i) => any(sells, i));
      bt = window.Backtest.backtest(state.bars, bs, ss, { fee: 0.001 });
      outputs.push({ type: 'panel', values: bt.equity, color: C.up, title: 'Strategie %', synthetic: true });
      outputs.push({ type: 'panel', values: bt.buyHold, color: 'rgba(122,133,151,0.9)', title: 'Buy & Hold %', synthetic: true });
    }
    state.script.bt = bt;
    const ms = performance.now() - t0;
    const sameShape = live && outputs.length === state.script.outputs.length && outputs.every((o, k) => o.type === state.script.outputs[k].type);
    state.script.outputs = outputs;
    if (!sameShape) {
      clearScriptVisuals();
      outputs.forEach((o) => {
        if (o.type === 'plot') state.script.series.push({ chart: main, s: main.addLineSeries(lineOpts(o.color, 2)), o });
        if (o.type === 'panel') state.script.series.push({ chart: panes.script.chart, s: panes.script.chart.addLineSeries(lineOpts(o.color, 2, { lastValueVisible: true })), o });
        if (o.type === 'hline') { const v = o.values[o.values.length - 1]; if (isNum(v)) state.script.lines.push(candle.createPriceLine({ price: v, color: o.color, lineWidth: 1, lineStyle: LW.LineStyle.Dotted, title: o.title })); }
      });
    }
    let k = 0;
    outputs.forEach((o) => { if (o.type === 'plot' || o.type === 'panel') state.script.series[k++].s.setData(toLine(o.values)); });
    // Signale (alert) als Pfeile unter den Kerzen; ausgelöst wird beim Wechsel von 0 auf 1.
    // Beschriftung nur, wenn es wenige Signale sind – sonst überlagern sich die Texte.
    const markers = []; let signals = 0;
    outputs.filter((o) => o.type === 'alert').forEach((o) => {
      const idx = []; o.values.forEach((v, i) => { if (v && !o.values[i - 1]) idx.push(i); });
      signals += idx.length;
      const withText = idx.length <= 6 && o.title.length <= 14;
      idx.forEach((i) => markers.push({ time: state.times[i], position: 'belowBar', color: o.color, shape: 'arrowUp', size: 1, text: withText ? o.title : '' }));
      const n = o.values.length - 1, key = o.title + '@' + state.bars[n].time;
      if (live && o.values[n] && !o.values[n - 1] && !state.script.notified.has(key)) {
        state.script.notified.add(key); toast('Skript-Signal: ' + o.title, `${state.symbol} bei ${fmtP(state.lastPrice)}`, 'signal'); beep();
      }
    });
    // Backtest: ausgeführte Käufe/Verkäufe an der Ausführungskerze, Verkäufe mit Ergebnis des Trades
    if (bt) {
      const few = bt.marks.length <= 16;
      bt.marks.forEach((m) => markers.push(m.side === 'buy'
        ? { time: state.times[m.i], position: 'belowBar', color: C.up, shape: 'arrowUp', size: 1.2, text: few ? 'Kauf' : '' }
        : { time: state.times[m.i], position: 'aboveBar', color: C.down, shape: 'arrowDown', size: 1.2, text: few ? `${m.ret >= 0 ? '+' : ''}${fmt(m.ret * 100, 1)} %` : '' }));
      const last = bt.marks[bt.marks.length - 1], key = 'bt:' + (last ? last.side + '@' + state.bars[last.i].time : '');
      if (live && last && last.i === state.bars.length - 1 && !state.script.notified.has(key)) {
        state.script.notified.add(key); toast(last.side === 'buy' ? 'Strategie kauft' : 'Strategie verkauft', `${state.symbol} zu ${fmtP(last.px)}`, 'signal'); beep();
      }
      renderBacktest(bt);
    } else { btEl.style.display = 'none'; btEl.closest('.card').classList.remove('has-bt'); }
    markers.sort((a, b) => a.time - b.time);
    candle.setMarkers(markers);
    out.innerHTML = `<span class="ok">✓ ${outputs.filter((o) => !o.synthetic).length} Ausgabe${outputs.length === 1 ? '' : 'n'}</span> · ${signals} Signal${signals === 1 ? '' : 'e'}${bt ? ` · ${bt.stats.trades} Trades` : ''} auf ${state.bars.length} Kerzen · ${ms.toFixed(1).replace('.', ',')} ms`;
  }
  function renderBacktest(bt) {
    const s = bt.stats, el = $('#btStats'); el.style.display = ''; el.closest('.card').classList.add('has-bt');
    const pct = (x, d = 1) => (isNum(x) ? `${x >= 0 ? '+' : ''}${fmt(x * 100, d)} %` : '–');
    const cell = (k, v, cls = '') => `<div><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
    const cmp = isNum(s.ret) && isNum(s.buyHoldRet) ? (s.ret > s.buyHoldRet ? 'pos' : 'neg') : '';
    el.innerHTML = `<div class="h">Backtest · nur long · nächste Eröffnung · ${fmt(bt.fee * 100, 1)} % Gebühr je Seite${s.open ? ' · Position offen' : ''}</div>`
      + cell('Strategie', pct(s.ret), cmp) + cell('Buy & Hold', pct(s.buyHoldRet)) + cell('Max. Rückgang', isNum(s.maxDD) ? `−${fmt(s.maxDD * 100, 1)} %` : '–', 'neg')
      + cell('Trades', s.trades) + cell('Trefferquote', isNum(s.winRate) ? `${fmt(s.winRate * 100, 0)} %` : '–') + cell('Profitfaktor', s.profitFactor === Infinity ? '∞' : isNum(s.profitFactor) ? fmt(s.profitFactor, 2) : '–')
      + cell('Ø Trade', pct(s.avgTrade, 2)) + cell('Investiert (Zeit)', `${fmt(s.exposure * 100, 0)} %`) + cell('Kerzen', state.bars.length);
  }
  $('#btnRun').onclick = applyScript;
  $('#btnClearScript').onclick = () => { state.script.text = ''; state.script.bt = null; store.set('script', ''); clearScriptVisuals(); state.script.outputs = []; $('#scriptOut').textContent = ''; $('#btStats').style.display = 'none'; $('#btStats').closest('.card').classList.remove('has-bt'); layoutPanes(); updateLegends(hoverIdx); };
  EXAMPLES.forEach((ex) => {
    const b = document.createElement('button'); b.textContent = ex.name;
    b.onclick = () => { code.value = ex.code; highlight(); applyScript(); };
    $('#examples').appendChild(b);
  });

  // ---------------- Kopfzeile ----------------
  function renderToolbarState() {
    const tg = $('#tfGroup'); tg.innerHTML = '';
    TFS.forEach((t) => {
      const b = document.createElement('button'); b.textContent = t.label; b.className = t.id === state.tf ? 'active' : '';
      b.disabled = isStock(state.symbol) && t.id === '1m';
      b.title = b.disabled ? 'Für Aktien nicht im Schnappschuss' : '';
      b.onclick = () => { state.tf = t.id; load(); }; tg.appendChild(b);
    });
    const ig = $('#indGroup'); ig.innerHTML = '';
    IND.forEach((d) => {
      const b = document.createElement('button'); b.textContent = d.label; b.className = state.ind[d.id] ? 'on' : ''; b.style.setProperty('--c', d.color);
      b.onclick = () => { state.ind[d.id] = !state.ind[d.id]; store.set('ind', IND.filter((x) => state.ind[x.id]).map((x) => x.id).join(',')); applyIndicatorVisibility(); layoutPanes(); updateLegends(hoverIdx); renderToolbarState(); };
      ig.appendChild(b);
    });
    $('#symbolInput').value = state.symbol;
    $('#btnTest').classList.toggle('on', state.test);
    document.querySelectorAll('#tape .chip').forEach((el) => el.classList.toggle('sel', el.dataset.sym === state.symbol));
  }
  function switchSymbol(s) {
    s = s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!s) return;
    if (s !== state.symbol) clearDrawings();
    state.symbol = s; state.watch[s] = state.watch[s]; load();
  }
  const dl = $('#symbolList');
  [...CRYPTO.map((s) => [s, 'Krypto · Binance live']), ...STOCKS.map((s) => [s, 'Aktie · Schnappschuss'])].forEach(([s, l]) => { const o = document.createElement('option'); o.value = s; o.label = l; dl.appendChild(o); });
  $('#symbolInput').addEventListener('change', (e) => switchSymbol(e.target.value));
  $('#symbolInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('#btnTest').onclick = () => { state.test = !state.test; if (state.test && state.wsWatch) { state.wsWatch.close(); state.wsWatch = null; } if (!state.test) startWatch(); load(); };
  document.querySelectorAll('#toolbar [data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  document.querySelector('[data-action="clear"]').onclick = clearDrawings;
  function setFullscreen(on) {
    const open = on ?? !document.body.classList.contains('fullscreen');
    document.body.classList.toggle('fullscreen', open);
    document.querySelector('[data-action="fullscreen"]').title = open ? 'Vollbild verlassen (Esc, Alt+V)' : 'Vollbild (Alt+V)';
    const h = $('#toolHint'); clearTimeout(setFullscreen.t);
    if (open) { h.textContent = 'Vollbild · Esc zum Verlassen'; h.style.display = 'block'; setFullscreen.t = setTimeout(() => { if (h.textContent.startsWith('Vollbild')) h.style.display = 'none'; }, 2000); }
    else if (h.textContent.startsWith('Vollbild')) h.style.display = 'none';
  }
  document.querySelector('[data-action="fullscreen"]').onclick = () => setFullscreen();
  document.querySelector('[data-action="fit"]').onclick = () => { const n = state.bars.length; main.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 6 }); main.priceScale('right').applyOptions({ autoScale: true }); };
  $('#licLink').onclick = (e) => { e.preventDefault(); $('#licDlg').showModal(); };
  document.addEventListener('keydown', (e) => {
    if (e.target === code || e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') { setTool('cross'); setFullscreen(false); }
    if (e.altKey && e.code === 'KeyV') { e.preventDefault(); setFullscreen(); }
    if (R.on && e.code === 'Space') { e.preventDefault(); replayPlay(!R.playing); }
    if (R.on && e.key === 'ArrowRight') { e.preventDefault(); $('#rpStep').onclick(); }
    if (e.altKey && e.code === 'KeyH') setTool('hline');
    if (e.altKey && e.code === 'KeyA') setTool('alarm');
    if (e.altKey && e.code === 'KeyT') setTool('trend');
    if (e.altKey && e.code === 'KeyF') setTool('fib');
    if (e.altKey && e.code === 'KeyP') setTool('pos');
    if (e.key === 'Backspace' || e.key === 'Delete') undoDrawing();
  });

  // ---------------- Start ----------------
  const saved = params.has('ex') ? null : store.get('script');
  code.value = typeof saved === 'string' && saved.trim() ? saved : 'plot(ema(close, 21))'; highlight();
  renderToolbarState(); startWatch();
  load().then(() => {
    // Optionale Vorführ-Parameter (für Screenshots/Video): ?ex=1 lädt ein Beispiel, ?demo=1 setzt Alarm + Trendlinie, ?replay=1 startet das Replay
    const ex = parseInt(params.get('ex'), 10);
    if (EXAMPLES[ex - 1]) { code.value = EXAMPLES[ex - 1].code; highlight(); applyScript(); }
    else if (saved && saved.trim()) applyScript();
    if (params.get('replay') === '1') { replayStart(); if (params.get('pause') === '1') replayPlay(false); }
    if (params.get('demo') === '1' && state.bars.length > 60) {
      const n = state.bars.length, b = state.bars;
      let i1 = n - 60, i2 = n - 15;
      for (let i = n - 80; i < n - 40; i++) if (b[i].low < b[i1].low) i1 = i;
      for (let i = n - 30; i < n - 3; i++) if (b[i].low < b[i2].low) i2 = i;
      addTrend({ idx: i1, time: state.times[i1], price: b[i1].low }, { idx: i2, time: state.times[i2], price: b[i2].low });
      addAlarm(state.lastPrice * (1 + (parseFloat(params.get('alarmPct')) || 0.15) / 100));
      addHLine(Math.max(...b.slice(-120).map((x) => x.high)));
    }
    window.__ready = true;
  });
  // Öffentliche Schnittstelle: für automatische Tests und für die Chart-Werkzeuge des Claude-Agenten (agent-panel.js)
  window.__sarge = {
    state, layer, IND, TFS, calc: () => calc, main, candle,
    addAlarm, addHLine, applyScript, replayStart, replayPlay, replayStop, clearDrawings, switchSymbol,
    setTimeframe: (tf) => { if (!TFS.some((t) => t.id === tf)) throw new Error('Zeiteinheit ' + tf + ' unbekannt'); state.tf = tf; return load(); },
    setIndicator: (id, on) => { if (!(id in state.ind)) throw new Error('Indikator ' + id + ' unbekannt'); state.ind[id] = !!on; store.set('ind', IND.filter((x) => state.ind[x.id]).map((x) => x.id).join(',')); applyIndicatorVisibility(); layoutPanes(); updateLegends(hoverIdx); renderToolbarState(); },
    runScript: (text) => { code.value = text; highlight(); applyScript(); return $('#scriptOut').textContent; },
    clearScript: () => $('#btnClearScript').onclick(),
    idxForTime: (t) => { let best = 0, d = Infinity; state.bars.forEach((b, i) => { const x = Math.abs(b.time - t); if (x < d) { d = x; best = i; } }); return best; },
    waitLoaded: () => new Promise((r) => { const k = setInterval(() => { if (state.bars.length && !state.loading) { clearInterval(k); r(); } }, 50); }),
    toast,
  };
})();
