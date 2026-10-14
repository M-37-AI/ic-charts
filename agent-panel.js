/*
 * agent-panel.js – Chat mit Claude direkt im Chart.
 *
 * Der Browser spricht per WebSocket mit agent/server.mjs. Dort läuft das Claude Agent SDK
 * (der Kern von Claude Code). Die Chart-Werkzeuge sind beim Server als Tools angemeldet,
 * ausgeführt werden sie aber HIER im Browser: der Server schickt {type:'tool_call'}, der Browser
 * führt die Funktion gegen window.__sarge aus und antwortet mit {type:'tool_result'}.
 *
 * Es gibt keine Börsenanbindung: Claude kann zeichnen, rechnen und lesen, aber nicht handeln.
 */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const A = () => window.__sarge;
  const params = new URLSearchParams(location.search);
  const defaultUrl = location.protocol.startsWith('http') ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/agent` : 'ws://localhost:8787/agent';
  let wsUrl = params.get('agent') || (() => { try { return localStorage.getItem('sarge.agentUrl'); } catch (e) { return null; } })() || defaultUrl;

  // ---------------- Chart-Werkzeuge (werden vom Server aufgerufen) ----------------
  const fmtTime = (t) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const toTime = (v) => { // ISO-Text, Unix-Sekunden oder "vor N Kerzen"
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return v > 1e11 ? v / 1000 : v;
    const d = Date.parse(v); if (!isNaN(d)) return d / 1000;
    throw new Error('Zeitangabe nicht verstanden: ' + v);
  };
  const point = (time, barsAgo, price) => {
    const S = A().state; let idx;
    if (barsAgo !== undefined && barsAgo !== null) idx = Math.max(0, S.bars.length - 1 - Math.round(barsAgo));
    else if (time !== undefined && time !== null) idx = A().idxForTime(toTime(time));
    else idx = S.bars.length - 1;
    const b = S.bars[idx];
    return { idx, time: S.times[idx], price: typeof price === 'number' ? price : b.close };
  };
  const round = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? +v.toFixed(d) : null);

  const TOOLS = {
    get_state() {
      const S = A().state, c = A().calc(), n = S.bars.length, b = S.bars[n - 1];
      return {
        symbol: S.symbol, timeframe: S.tf, source: S.source, bars: n, last_price: S.lastPrice,
        last_bar: { time: fmtTime(b.time), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume },
        indicators_on: Object.keys(S.ind).filter((k) => S.ind[k]),
        values: { sma50: round(c.sma[n - 1], 4), ema21: round(c.ema[n - 1], 4), bb_upper: round(c.bb.upper[n - 1], 4), bb_lower: round(c.bb.lower[n - 1], 4), vwap: round(c.vwap[n - 1], 4), rsi14: round(c.rsi[n - 1]), macd: round(c.macd.macd[n - 1], 4), macd_signal: round(c.macd.signal[n - 1], 4), supertrend: round(c.st.line[n - 1], 4), supertrend_dir: c.st.dir[n - 1] === 1 ? 'up' : 'down', btc_dominance_pct: S.ind.btcd ? round(c.btcd?.[n - 1]) : undefined },
        alarms: S.alarms.map((a) => ({ price: a.price, fired: a.fired })),
        drawings: A().layer.shapes.map((s) => (s.type === 'fib' ? { type: 'fib', from: s.a.price, to: s.b.price } : s.type === 'pos' ? { type: 'position', entry: s.entry.price, target: s.target.price, stop: s.stop.price } : s.type === 'line' ? { type: 'line', label: s.label, kind: s.kind, from: s.a.price, to: s.b.price } : s.type === 'level' ? { type: 'level', label: s.label, kind: s.kind, price: s.price } : s.type === 'zone' ? { type: 'zone', label: s.label, low: Math.min(s.p1, s.p2), high: Math.max(s.p1, s.p2) } : s.type === 'poly' ? { type: 'pattern', label: s.label, points: s.pts.length } : { type: 'note', text: s.text })),
        script: S.script.text || null, backtest: S.script.bt ? S.script.bt.stats : null, replay: S.replay.on,
      };
    },
    get_bars({ count = 50 } = {}) {
      const S = A().state, c = A().calc(), n = S.bars.length, k = Math.min(Math.max(1, Math.round(count)), 500);
      return { symbol: S.symbol, timeframe: S.tf, columns: ['time_utc', 'open', 'high', 'low', 'close', 'volume', 'rsi14', 'ema21'],
        rows: S.bars.slice(n - k).map((b, j) => { const i = n - k + j; return [fmtTime(b.time), b.open, b.high, b.low, b.close, round(b.volume, 2), round(c.rsi[i]), round(c.ema[i], 4)]; }) };
    },
    find_extremes({ lookback = 100 } = {}) {
      const S = A().state, n = S.bars.length, k = Math.min(Math.max(2, Math.round(lookback)), n);
      let hi = n - k, lo = n - k;
      for (let i = n - k; i < n; i++) { if (S.bars[i].high > S.bars[hi].high) hi = i; if (S.bars[i].low < S.bars[lo].low) lo = i; }
      return { lookback: k, highest: { price: S.bars[hi].high, time: fmtTime(S.bars[hi].time), bars_ago: n - 1 - hi }, lowest: { price: S.bars[lo].low, time: fmtTime(S.bars[lo].time), bars_ago: n - 1 - lo } };
    },
    async set_symbol({ symbol }) { A().switchSymbol(symbol); await A().waitLoaded(); return { ok: true, symbol: A().state.symbol, bars: A().state.bars.length, source: A().state.source }; },
    async set_timeframe({ timeframe }) { await A().setTimeframe(String(timeframe).toLowerCase()); await A().waitLoaded(); return { ok: true, timeframe: A().state.tf }; },
    set_indicators(input) { const S = A().state; Object.entries(input || {}).forEach(([k, v]) => { if (k in S.ind) A().setIndicator(k, v); }); return { on: Object.keys(S.ind).filter((k) => S.ind[k]) }; },
    run_script({ code }) { const out = A().runScript(code); if (out.startsWith('✕')) throw new Error(out); const bt = A().state.script.bt; return { result: out, backtest: bt ? bt.stats : null }; },
    clear_script() { A().clearScript(); return { ok: true }; },
    add_alarm({ price }) { A().addAlarm(+price); return { ok: true, price: +price }; },
    add_hline({ price }) { A().addHLine(+price); return { ok: true, price: +price }; },
    draw_fibonacci({ from_time, from_bars_ago, from_price, to_time, to_bars_ago, to_price }) {
      const a = point(from_time, from_bars_ago, from_price), b = point(to_time, to_bars_ago, to_price);
      A().layer.add({ type: 'fib', a, b });
      const lv = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((l) => ({ level: l, price: round(b.price + (a.price - b.price) * l, 4) }));
      A().toast('Claude zeichnet', `Fibonacci ${round(a.price)} → ${round(b.price)}`, 'signal');
      return { ok: true, levels: lv };
    },
    draw_position({ entry, target, stop, time, bars_ago }) {
      const p = point(time, bars_ago, +entry);
      A().layer.add({ type: 'pos', entry: p, target: { ...p, price: +target }, stop: { ...p, price: +stop }, idx0: p.idx, idx1: p.idx + 20 });
      const crv = Math.abs(target - entry) / Math.abs(entry - stop);
      A().toast('Claude zeichnet', `${target >= entry ? 'Long' : 'Short'} · CRV 1 : ${crv.toFixed(2)}`, 'signal');
      return { ok: true, side: target >= entry ? 'long' : 'short', crv: round(crv) };
    },
    clear_drawings() { A().clearDrawings(); return { ok: true }; },
    undo_drawing() { const s = A().layer.removeLast(); return { removed: s ? s.type : null, remaining: A().layer.shapes.length }; },
    // Wendepunkte (Swing-Hochs/-Tiefs): ein Hoch, das in `strength` Kerzen links und rechts nicht übertroffen wird
    find_pivots({ lookback = 200, strength = 5 } = {}) {
      const S = A().state, n = S.bars.length, k = Math.min(Math.max(10, Math.round(lookback)), n), st = Math.max(1, Math.round(strength));
      const out = [];
      for (let i = Math.max(st, n - k); i < n - st; i++) {
        const b = S.bars[i]; let hi = true, lo = true;
        for (let j = i - st; j <= i + st && (hi || lo); j++) { if (j === i) continue; if (S.bars[j].high >= b.high) hi = false; if (S.bars[j].low <= b.low) lo = false; }
        if (hi) out.push({ type: 'high', price: b.high, bars_ago: n - 1 - i, time: fmtTime(b.time) });
        if (lo) out.push({ type: 'low', price: b.low, bars_ago: n - 1 - i, time: fmtTime(b.time) });
      }
      return { lookback: k, strength: st, last_price: S.lastPrice, pivots: out.slice(-40) };
    },
    draw_line({ from_bars_ago, from_price, to_bars_ago, to_price, extend_right = true, label = '', kind = 'trend', dashed = false }) {
      const a = point(undefined, from_bars_ago, +from_price), b = point(undefined, to_bars_ago, +to_price);
      A().layer.add({ type: 'line', a, b, extend: !!extend_right, label: String(label), kind, dashed: !!dashed });
      return { ok: true, from: a.price, to: b.price, label };
    },
    draw_level({ price, label = '', kind = 'support', from_bars_ago = 150 }) {
      const p = point(undefined, from_bars_ago, +price);
      A().layer.add({ type: 'level', price: +price, idx0: p.idx, label: String(label), kind });
      return { ok: true, price: +price, label, kind };
    },
    draw_zone({ price_low, price_high, from_bars_ago = 150, to_bars_ago = 0, label = '', kind = 'neutral' }) {
      const a = point(undefined, from_bars_ago), b = point(undefined, to_bars_ago);
      A().layer.add({ type: 'zone', p1: +price_low, p2: +price_high, idx0: a.idx, idx1: Math.max(b.idx, a.idx + 1), label: String(label), kind });
      return { ok: true, label };
    },
    draw_pattern({ points, label = '', closed = false, kind = 'pattern' }) {
      if (!Array.isArray(points) || points.length < 2) throw new Error('Mindestens zwei Punkte');
      const pts = points.map((q) => point(undefined, q.bars_ago, +q.price));
      A().layer.add({ type: 'poly', pts, closed: !!closed, label: String(label), kind });
      A().toast('Claude zeichnet', label || 'Muster', 'signal');
      return { ok: true, points: pts.length, label };
    },
    annotate({ bars_ago = 0, price, text, kind = 'neutral', above = true }) {
      const p = point(undefined, bars_ago, price !== undefined ? +price : undefined);
      A().layer.add({ type: 'note', idx: p.idx, price: p.price, text: String(text), kind, above: !!above });
      return { ok: true, text };
    },
    async optimize_strategy({ code, param1, param2, metric = 'return' }) {
      const r = await window.__lab.optimize({ code, param1, param2, metric });
      const { grid, ...rest } = r; return { ...rest, grid_rows: grid.length, grid: grid.length <= 120 ? grid : grid.filter((_, i) => i % Math.ceil(grid.length / 120) === 0) };
    },
    replay({ action = 'start' }) { const r = A().state.replay; if (action === 'start') A().replayStart(); else if (action === 'stop') A().replayStop(); else if (action === 'pause') A().replayPlay(false); else if (action === 'play') A().replayPlay(true); return { replay: r.on, position: r.pos }; },
    screenshot() {
      const cv = A().main.takeScreenshot();
      return { image_png_base64: cv.toDataURL('image/png').split(',')[1], width: cv.width, height: cv.height };
    },
  };

  // ---------------- Panel ----------------
  const panel = document.createElement('aside'); panel.id = 'agent';
  panel.innerHTML = `
    <div class="ag-head"><b>Claude im Chart</b><span id="agStatus" class="ag-status"><i></i><span>getrennt</span></span><button id="agNew" class="ghost small" title="Neue Unterhaltung">Neu</button><button id="agClose" class="ghost small" title="Schließen (Alt+C)">✕</button></div>
    <div id="agMsgs" class="ag-msgs"></div>
    <div class="ag-quick" id="agQuick"></div>
    <div class="ag-input"><textarea id="agText" rows="2" placeholder="Frag Claude … (Enter sendet, Umschalt+Enter = Zeile)"></textarea><button id="agSend" class="primary">Senden</button><button id="agStop" class="ghost" style="display:none">Stopp</button></div>
    <div class="ag-foot"><span id="agCost"></span><span class="spacer"></span><a href="#" id="agUrl" title="Adresse des Agenten-Servers ändern">${wsUrl}</a></div>`;
  $('#app').appendChild(panel);
  // Beispielprompts: kurze Beschriftung auf dem Knopf, der volle Text wird gesendet (und als Tooltip gezeigt)
  const QUICK = [
    ['Chart analysieren und einzeichnen', 'Analysiere den Chart und zeichne ein, was du siehst: Trendlinien, Unterstützungen, Widerstände, Muster – alles beschriftet.'],
    ['EMA-Strategie optimieren', 'Optimiere eine EMA-Kreuzungs-Strategie: schnelle EMA 5–30, langsame EMA 20–80. Schlägt sie Buy & Hold?'],
    ['Fibonacci über 150 Kerzen', 'Zeichne ein Fibonacci vom höchsten Hoch zum tiefsten Tief der letzten 150 Kerzen.'],
    ['Alarm 1 % über dem Kurs', 'Setze einen Alarm 1 % über dem aktuellen Kurs.'],
    ['Chart als Bild beschreiben', 'Schau dir den Chart als Bild an und beschreibe die Struktur.'],
  ];
  QUICK.forEach(([label, q]) => { const b = document.createElement('button'); b.textContent = label; b.title = q; b.onclick = () => { $('#agText').value = q; send(); }; $('#agQuick').appendChild(b); });

  const msgs = $('#agMsgs');
  let cur = null; // laufende Assistant-Blase
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Sehr kleines Markdown: Codeblöcke, Inline-Code, fett, Listen, Absätze
  function md(src) {
    const parts = src.split(/```/); let out = '';
    parts.forEach((p, i) => {
      if (i % 2) { out += `<pre><code>${esc(p.replace(/^\w*\n/, ''))}</code></pre>`; return; }
      let h = esc(p).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      h = h.split(/\n{2,}/).map((para) => (/^(\s*[-*] .*\n?)+$/.test(para) ? '<ul>' + para.trim().split('\n').map((l) => `<li>${l.replace(/^\s*[-*] /, '')}</li>`).join('') + '</ul>' : `<p>${para.replace(/\n/g, '<br>')}</p>`)).join('');
      out += h;
    });
    return out;
  }
  function bubble(role, html) { const d = document.createElement('div'); d.className = 'ag-msg ' + role; d.innerHTML = html; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; }
  function toolChip(name, input, state = 'run') {
    const d = document.createElement('div'); d.className = 'ag-tool ' + state;
    const short = name.replace(/^mcp__chart__/, 'chart.');
    const arg = input && Object.keys(input).length ? ' ' + esc(JSON.stringify(input)).slice(0, 90) : '';
    d.innerHTML = `<i></i><b>${esc(short)}</b><span>${arg}</span>`; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
  }
  let curText = '';
  function appendText(t) {
    if (!cur) { cur = bubble('assistant', ''); curText = ''; }
    curText += t; cur.innerHTML = md(curText); msgs.scrollTop = msgs.scrollHeight;
  }
  function endAssistant() { cur = null; curText = ''; }

  // ---------------- Verbindung ----------------
  let ws = null, busy = false, retry = 0;
  const pendingTools = new Map();
  function setStatus(kind, text) { const s = $('#agStatus'); s.className = 'ag-status ' + kind; s.querySelector('span').textContent = text; }
  function connect() {
    try { ws = new WebSocket(wsUrl); } catch (e) { setStatus('off', 'Adresse ungültig'); return; }
    setStatus('', 'verbinde …');
    ws.onopen = () => { retry = 0; setStatus('live', 'verbunden'); };
    ws.onclose = () => { setStatus('off', 'Server aus · agent/server.mjs starten'); setBusy(false); setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++)); };
    ws.onerror = () => {};
    ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'status') { setStatus(m.ready ? 'live' : 'off', m.text || (m.ready ? 'bereit' : 'nicht bereit')); if (m.model) $('#agCost').textContent = m.model; }
      else if (m.type === 'text_delta') appendText(m.text);
      else if (m.type === 'assistant_done') endAssistant();
      else if (m.type === 'tool_use') { endAssistant(); toolChip(m.name, m.input, 'done'); }
      else if (m.type === 'tool_call') {
        endAssistant();
        const chip = toolChip(m.name, m.input, 'run');
        try {
          const fn = TOOLS[m.name]; if (!fn) throw new Error('Unbekanntes Werkzeug ' + m.name);
          const result = await fn(m.input || {});
          ws.send(JSON.stringify({ type: 'tool_result', id: m.id, ok: true, result }));
          chip.className = 'ag-tool done';
        } catch (e) { ws.send(JSON.stringify({ type: 'tool_result', id: m.id, ok: false, error: e.message })); chip.className = 'ag-tool err'; chip.querySelector('span').textContent = ' ' + e.message; }
      }
      else if (m.type === 'result') {
        endAssistant(); setBusy(false);
        const c = m.cost !== undefined ? `${m.cost.toFixed(4).replace('.', ',')} $` : '';
        $('#agCost').textContent = [m.model, c, m.turns ? `${m.turns} Züge` : '', m.duration ? `${(m.duration / 1000).toFixed(1).replace('.', ',')} s` : ''].filter(Boolean).join(' · ');
        if (m.error) bubble('error', esc(m.error));
      }
      else if (m.type === 'error') { endAssistant(); setBusy(false); bubble('error', esc(m.message)); }
    };
  }
  function setBusy(b) { busy = b; $('#agSend').style.display = b ? 'none' : ''; $('#agStop').style.display = b ? '' : 'none'; $('#agText').disabled = b; }
  function send() {
    const t = $('#agText').value.trim(); if (!t || busy) return;
    if (!ws || ws.readyState !== 1) { bubble('error', 'Keine Verbindung zum Agenten-Server. Auf dem Rechner mit der Claude-Anmeldung starten: <code>cd agent && npm start</code>'); return; }
    bubble('user', md(t)); $('#agText').value = ''; setBusy(true);
    ws.send(JSON.stringify({ type: 'user', text: t, context: TOOLS.get_state() }));
  }
  $('#agSend').onclick = send;
  $('#agStop').onclick = () => ws && ws.send(JSON.stringify({ type: 'abort' }));
  $('#agNew').onclick = () => { msgs.innerHTML = ''; ws && ws.send(JSON.stringify({ type: 'new_session' })); };
  $('#agText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#agUrl').onclick = (e) => { e.preventDefault(); const u = prompt('WebSocket-Adresse des Agenten-Servers', wsUrl); if (u) { wsUrl = u; try { localStorage.setItem('sarge.agentUrl', u); } catch (x) { /* egal */ } $('#agUrl').textContent = u; if (ws) ws.close(); } };

  // Umschalten
  const btn = document.createElement('button'); btn.id = 'btnAgent'; btn.className = 'pill'; btn.textContent = '✦ Claude'; btn.title = 'Claude im Chart (Alt+C)';
  $('#btnReplay').before(btn);
  function toggle(on) { const open = on ?? !document.body.classList.contains('agent-open'); document.body.classList.toggle('agent-open', open); btn.classList.toggle('on', open); if (open) { $('#agText').focus(); if (!ws) connect(); } }
  btn.onclick = () => toggle(); $('#agClose').onclick = () => toggle(false);
  document.addEventListener('keydown', (e) => { if (e.altKey && e.code === 'KeyC') toggle(); });
  if (params.get('claude') === '1') toggle(true);
  window.__agent = { TOOLS, send, toggle, connect };
})();
