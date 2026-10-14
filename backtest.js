/*
 * backtest.js – ein kleiner, ehrlicher Backtester für Mini-Script-Strategien.
 *
 * Regeln (bewusst einfach und nachvollziehbar):
 *  - Nur Long: entweder voll investiert oder in Cash. Kein Hebel, kein Nachkauf.
 *  - Ein Signal auf Kerze t wird zur ERÖFFNUNG von Kerze t+1 ausgeführt
 *    (kein Blick in die Zukunft: der Schlusskurs, der das Signal erzeugt, ist zu dem Zeitpunkt bekannt).
 *  - Gebühr je Seite in Prozent (Standard 0,1 %), abgezogen beim Kauf und beim Verkauf.
 *  - Offene Position am Ende wird zum letzten Schlusskurs bewertet, aber nicht als Trade gezählt.
 *  - Kapitalkurve startet bei 100 (= 100 %), Buy & Hold ebenso ab der ersten Kerze.
 */
(function (root) {
  'use strict';
  const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);

  function backtest(bars, buySig, sellSig, opts = {}) {
    const fee = isNum(opts.fee) ? opts.fee : 0.001;
    const N = bars.length;
    const equity = new Array(N).fill(null), buyHold = new Array(N).fill(null);
    const trades = [], marks = [];
    let cash = 1, units = 0, inPos = false, entry = null, entryCash = 1, posBars = 0;
    const base = bars[0]?.close || 1;
    for (let i = 0; i < N; i++) {
      if (i > 0) {
        const b = buySig[i - 1], s = sellSig[i - 1];
        if (!inPos && b) {
          entryCash = cash; units = (cash * (1 - fee)) / bars[i].open; cash = 0; inPos = true;
          entry = { i, px: bars[i].open };
          marks.push({ i, side: 'buy', px: bars[i].open });
        } else if (inPos && s) {
          cash = units * bars[i].open * (1 - fee); units = 0; inPos = false;
          const ret = cash / entryCash - 1;
          trades.push({ in: entry.i, out: i, inPx: entry.px, outPx: bars[i].open, ret, bars: i - entry.i });
          marks.push({ i, side: 'sell', px: bars[i].open, ret });
        }
      }
      equity[i] = (cash + units * bars[i].close) * 100;
      buyHold[i] = (bars[i].close / base) * 100;
      if (inPos) posBars++;
    }
    // Kennzahlen
    const wins = trades.filter((t) => t.ret > 0), losses = trades.filter((t) => t.ret <= 0);
    const sumW = wins.reduce((s, t) => s + t.ret, 0), sumL = -losses.reduce((s, t) => s + t.ret, 0);
    let peak = -Infinity, maxDD = 0;
    for (const e of equity) { if (!isNum(e)) continue; peak = Math.max(peak, e); maxDD = Math.max(maxDD, 1 - e / peak); }
    const last = equity[N - 1];
    return {
      equity, buyHold, trades, marks, fee,
      stats: {
        trades: trades.length, wins: wins.length, winRate: trades.length ? wins.length / trades.length : null,
        ret: isNum(last) ? last / 100 - 1 : null, buyHoldRet: isNum(buyHold[N - 1]) ? buyHold[N - 1] / 100 - 1 : null,
        maxDD, profitFactor: sumL > 0 ? sumW / sumL : wins.length ? Infinity : null,
        avgTrade: trades.length ? trades.reduce((s, t) => s + t.ret, 0) / trades.length : null,
        open: inPos, exposure: N ? posBars / N : 0,
      },
    };
  }

  const api = { backtest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Backtest = api;
})(typeof window !== 'undefined' ? window : globalThis);
