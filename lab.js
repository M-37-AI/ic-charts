/*
 * lab.js – Strategie-Labor: Parameter einer Mini-Script-Strategie durchprobieren und als Hitzekarte zeigen.
 *
 * Das Script enthält Platzhalter wie $schnell und $langsam. Für jede Kombination wird das Script
 * mit eingesetzten Werten ausgeführt (MiniScript.run) und der Backtest gerechnet (Backtest.backtest).
 * Ergebnis: Raster aus Kennzahlen, bester Wert, Buy & Hold als Maßstab und ein ehrlicher
 * Robustheitstest: Parameter nur auf den ersten 70 % der Kerzen gewählt, dann auf den letzten 30 % geprüft.
 */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const A = () => window.__sarge;
  const fmt = (v, d = 1) => (typeof v === 'number' && isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
  const pct = (v, d = 1) => (typeof v === 'number' && isFinite(v) ? `${v >= 0 ? '+' : ''}${fmt(v * 100, d)} %` : '–');

  function range(p) {
    const step = p.step || 1, out = [];
    for (let v = p.from; v <= p.to + 1e-9; v += step) out.push(+v.toFixed(6));
    if (out.length > 60) throw new Error(`Parameter ${p.name}: höchstens 60 Werte (jetzt ${out.length})`);
    return out;
  }
  function evalStrategy(code, bars, fee = 0.001) {
    const outputs = window.MiniScript.run(code, bars);
    const buys = outputs.filter((o) => o.type === 'buy'), sells = outputs.filter((o) => o.type === 'sell');
    if (!buys.length || !sells.length) throw new Error('Das Script braucht buy(...) und sell(...)');
    const n = bars.length, any = (arr, i) => arr.some((o) => o.values[i]);
    const bt = window.Backtest.backtest(bars, Array.from({ length: n }, (_, i) => any(buys, i)), Array.from({ length: n }, (_, i) => any(sells, i)), { fee });
    return bt.stats;
  }
  const fill = (code, vals) => Object.entries(vals).reduce((c, [k, v]) => c.split('$' + k).join(String(v)), code);
  const metricOf = (s, m) => (m === 'profit_factor' ? (s.profitFactor === Infinity ? 99 : s.profitFactor) : m === 'max_drawdown' ? -s.maxDD : m === 'win_rate' ? s.winRate : s.ret);

  async function optimize({ code, param1, param2, metric = 'return', fee = 0.001 }) {
    if (!code || !param1) throw new Error('code und param1 nötig');
    const bars = A().state.bars; if (bars.length < 100) throw new Error('Zu wenig Kerzen');
    const v1 = range(param1), v2 = param2 ? range(param2) : [null];
    if (v1.length * v2.length > 900) throw new Error('Höchstens 900 Kombinationen');
    const t0 = performance.now();
    const grid = []; let k = 0;
    const cut = Math.floor(bars.length * 0.7), inBars = bars.slice(0, cut), outBars = bars.slice(cut);
    for (const b of v2) for (const a of v1) {
      const vals = { [param1.name]: a }; if (param2) vals[param2.name] = b;
      let stats = null, err = null, inS = null;
      try { stats = evalStrategy(fill(code, vals), bars, fee); inS = evalStrategy(fill(code, vals), inBars, fee); } catch (e) { err = e.message; }
      grid.push({ a, b, vals, stats, inSample: inS, error: err });
      if (++k % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const ok = grid.filter((g) => g.stats);
    if (!ok.length) throw new Error('Keine Kombination lief: ' + (grid[0].error || '?'));
    const score = (g) => metricOf(g.stats, metric);
    const best = ok.reduce((x, y) => (score(y) > score(x) ? y : x));
    const bh = ok[0].stats.buyHoldRet;
    // Robustheit: Wahl nur auf den ersten 70 %, Prüfung auf den letzten 30 %
    const okIn = ok.filter((g) => g.inSample);
    const bestIn = okIn.reduce((x, y) => (metricOf(y.inSample, metric) > metricOf(x.inSample, metric) ? y : x), okIn[0]);
    let outTest = null;
    if (bestIn) { try { outTest = evalStrategy(fill(code, bestIn.vals), outBars, fee); } catch (e) { outTest = null; } }
    const rets = ok.map((g) => g.stats.ret).sort((x, y) => x - y);
    const result = {
      metric, fee, bars: bars.length, combos: ok.length, failed: grid.length - ok.length, ms: Math.round(performance.now() - t0),
      param1: { name: param1.name, values: v1 }, param2: param2 ? { name: param2.name, values: v2 } : null,
      buy_hold: bh, best: { params: best.vals, ...best.stats },
      beat_buy_hold: ok.filter((g) => g.stats.ret > bh).length, median_return: rets[Math.floor(rets.length / 2)],
      robustness: bestIn && outTest ? { chosen_on_first_70pct: bestIn.vals, in_sample_return: bestIn.inSample.ret, out_of_sample_return: outTest.ret, out_of_sample_buy_hold: outTest.buyHoldRet, out_of_sample_trades: outTest.trades } : null,
      grid: grid.map((g) => ({ ...g.vals, return: g.stats ? +(g.stats.ret * 100).toFixed(2) : null, trades: g.stats?.trades ?? null, max_dd: g.stats ? +(g.stats.maxDD * 100).toFixed(1) : null, win_rate: g.stats && g.stats.winRate !== null ? +(g.stats.winRate * 100).toFixed(0) : null, pf: g.stats ? (g.stats.profitFactor === Infinity ? null : +(g.stats.profitFactor ?? 0).toFixed(2)) : null })),
    };
    render({ code, param1, param2, metric, v1, v2, grid, best, bh, result });
    return result;
  }

  // ---------------- Anzeige ----------------
  const panel = document.createElement('div'); panel.id = 'lab'; panel.style.display = 'none';
  panel.innerHTML = `<div class="lab-head"><b>Strategie-Labor</b><span id="labSub" class="muted"></span><span class="spacer"></span><button id="labClose" class="ghost small">✕</button></div>
    <div class="lab-body"><div id="labGrid"></div><div id="labSide"></div></div>`;
  $('#stage').appendChild(panel);
  $('#labClose').onclick = () => (panel.style.display = 'none');
  let last = null;
  function color(v, lo, hi) { // Koralle (schlecht) über neutral zu Mint (gut), 0 = Mitte bei Rendite
    if (v === null || !isFinite(v)) return 'rgba(255,255,255,0.04)';
    const t = hi === lo ? 0.5 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    const c1 = [255, 107, 122], c2 = [38, 42, 50], c3 = [61, 220, 151];
    const mix = (a, b, f) => a.map((x, i) => Math.round(x + (b[i] - x) * f));
    const c = t < 0.5 ? mix(c1, c2, t * 2) : mix(c2, c3, (t - 0.5) * 2);
    return `rgb(${c.join(',')})`;
  }
  function render(r) {
    last = r; panel.style.display = '';
    const { v1, v2, grid, best, bh, param1, param2, metric, result } = r;
    const vals = grid.map((g) => (g.stats ? metricOf(g.stats, metric) : null)).filter((v) => v !== null);
    const lo = Math.min(...vals, metric === 'return' ? bh : Infinity), hi = Math.max(...vals, metric === 'return' ? bh : -Infinity);
    const span = Math.max(Math.abs(lo - (metric === 'return' ? bh : 0)), Math.abs(hi - (metric === 'return' ? bh : 0))) || 1;
    const mid = metric === 'return' ? bh : (lo + hi) / 2; // Buy & Hold als neutrale Mitte
    $('#labSub').textContent = `${A().state.symbol} ${A().state.tf} · ${result.bars} Kerzen · ${result.combos} Kombinationen in ${result.ms} ms · Buy & Hold ${pct(bh)}`;
    const cell = (g) => {
      const v = g.stats ? metricOf(g.stats, metric) : null;
      const isBest = g === best;
      const txt = g.stats ? (metric === 'return' ? pct(g.stats.ret, 0) : fmt(v, 2)) : '✕';
      return `<div class="lab-cell${isBest ? ' best' : ''}" style="background:${color(v, mid - span, mid + span)}" title="${param1.name}=${g.a}${param2 ? ` ${param2.name}=${g.b}` : ''}\nRendite ${g.stats ? pct(g.stats.ret) : '–'} · Trades ${g.stats?.trades ?? '–'} · max. Rückgang ${g.stats ? '−' + fmt(g.stats.maxDD * 100) + ' %' : '–'} · Treffer ${g.stats && g.stats.winRate !== null ? fmt(g.stats.winRate * 100, 0) + ' %' : '–'}" data-a="${g.a}" data-b="${g.b ?? ''}">${txt}</div>`;
    };
    let html = `<div class="lab-table" style="grid-template-columns:auto repeat(${v1.length},1fr)">`;
    html += `<div class="lab-corner">${param2 ? `${param2.name} ↓ · ${param1.name} →` : param1.name + ' →'}</div>` + v1.map((a) => `<div class="lab-ax">${a}</div>`).join('');
    v2.forEach((b, j) => { html += `<div class="lab-ax">${b ?? ''}</div>` + grid.slice(j * v1.length, (j + 1) * v1.length).map(cell).join(''); });
    html += '</div>';
    $('#labGrid').innerHTML = html;
    $('#labGrid').querySelectorAll('.lab-cell').forEach((el) => { el.onclick = () => apply(+el.dataset.a, el.dataset.b === '' ? null : +el.dataset.b); });
    const rb = result.robustness;
    const verdict = best.stats.ret > bh ? `Beste Kombination schlägt Buy & Hold um ${pct(best.stats.ret - bh)}.` : `Keine Kombination schlägt Buy & Hold dauerhaft; die beste liegt ${pct(best.stats.ret - bh)} dahinter.`;
    $('#labSide').innerHTML = `
      <div class="lab-stat"><span class="k">Beste Kombination (${metric === 'return' ? 'Rendite' : metric})</span><span class="v">${Object.entries(best.vals).map(([k, v]) => `${k} = ${v}`).join(' · ')}</span></div>
      <div class="lab-row"><div class="lab-stat"><span class="k">Strategie</span><span class="v ${best.stats.ret >= bh ? 'pos' : 'neg'}">${pct(best.stats.ret)}</span></div><div class="lab-stat"><span class="k">Buy & Hold</span><span class="v">${pct(bh)}</span></div><div class="lab-stat"><span class="k">Trades</span><span class="v">${best.stats.trades}</span></div></div>
      <div class="lab-row"><div class="lab-stat"><span class="k">Schlagen B&H</span><span class="v">${result.beat_buy_hold} von ${result.combos}</span></div><div class="lab-stat"><span class="k">Median Rendite</span><span class="v">${pct(result.median_return)}</span></div><div class="lab-stat"><span class="k">Max. Rückgang</span><span class="v neg">−${fmt(best.stats.maxDD * 100)} %</span></div></div>
      ${rb ? `<div class="lab-stat robust"><span class="k">Robustheitstest · Wahl auf den ersten 70 %, Prüfung auf den letzten 30 %</span><span class="v">${Object.entries(rb.chosen_on_first_70pct).map(([k, v]) => `${k} = ${v}`).join(' · ')}</span><span class="v small">vorher ${pct(rb.in_sample_return)} · danach <b class="${rb.out_of_sample_return >= rb.out_of_sample_buy_hold ? 'pos' : 'neg'}">${pct(rb.out_of_sample_return)}</b> (Buy & Hold danach ${pct(rb.out_of_sample_buy_hold)}, ${rb.out_of_sample_trades} Trades)</span></div>` : ''}
      <div class="lab-verdict">${verdict}</div>
      <div class="muted small">Klick auf eine Zelle setzt die Parameter ins Script. Farbe: Mint besser als Buy & Hold, Koralle schlechter.</div>`;
  }
  function apply(a, b) {
    if (!last) return;
    const vals = { [last.param1.name]: a }; if (last.param2) vals[last.param2.name] = b;
    A().runScript(fill(last.code, vals));
    $('#labGrid').querySelectorAll('.lab-cell').forEach((el) => el.classList.toggle('sel', +el.dataset.a === a && (last.param2 ? +el.dataset.b === b : true)));
  }
  window.__lab = { optimize, evalStrategy, fill, show: () => { if (last) panel.style.display = ''; }, hide: () => (panel.style.display = 'none') };
})();
