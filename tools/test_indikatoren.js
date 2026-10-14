// Prüft indicators.js gegen veröffentlichte Referenzwerte und eine unabhängige Zweitrechnung.
// Start: node tools/test_indikatoren.js   (Node 18, keine Pakete)
const I = require('../indicators.js');
let ok = 0, fail = 0; const rows = [];
function check(name, got, exp, tol) {
  const pass = got !== null && Math.abs(got - exp) <= tol;
  pass ? ok++ : fail++;
  rows.push(`| ${name} | ${exp} | ${got === null ? 'null' : got.toFixed(4)} | ${pass ? 'OK' : 'FEHLER'} |`);
}
// 1) RSI(14) – Beispielreihe aus StockCharts ChartSchool (Wilder-Methode, cs-rsi)
// Kurse mit 4 Nachkommastellen wie in der Original-Tabelle (angezeigt werden dort nur 2)
const rsiData = [44.3389,44.0902,44.1497,43.6124,44.3278,44.8264,45.0955,45.4245,45.8433,46.0826,45.8931,46.0328,45.6140,46.2820,46.2820,46.0028,46.0328,46.4116,46.2222,45.6439,46.2122,46.2521,45.7137,46.4515,45.7835,45.3548,44.0288,44.1783,44.2181,44.5672,43.4205,42.6628,43.1314];
const rsiRef = [70.53,66.32,66.55,69.41,66.36,57.97,62.93,63.26,56.06,62.38,54.71,50.42,39.99,41.46,41.87,45.46,37.30,33.08,37.77];
const r = I.rsi(rsiData, 14);
rsiRef.forEach((v, k) => check(`RSI14 Tag ${15 + k}`, r[14 + k], v, 0.01 + 1e-9));
// 2) SMA/EMA(10) – Beispielreihe aus StockCharts ChartSchool (cs-movavg)
const maData = [22.2734,22.194,22.0847,22.1741,22.184,22.1344,22.2337,22.4323,22.2436,22.2933,22.1542,22.3926,22.3816,22.6109,23.3558,24.0519,23.753,23.8324,23.9516,23.6338,23.8225,23.8722,23.6537,23.187,23.0976,23.326,22.6805,23.0976,22.4025,22.1725];
const emaRef = [22.22,22.21,22.24,22.27,22.33,22.52,22.80,22.97,23.13,23.28,23.34,23.43,23.51,23.54,23.47,23.40,23.39,23.26,23.23,23.08,22.92];
const e = I.ema(maData, 10), s = I.sma(maData, 10);
check('SMA10 Tag 10', s[9], 22.22, 0.005 + 1e-9);
emaRef.forEach((v, k) => check(`EMA10 Tag ${10 + k}`, e[9 + k], v, 0.005 + 1e-9));
// 3) Zweitrechnung mit naiver, unabhängiger Formel auf Zufallsreihe (Bollinger, MACD, VWAP)
let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const px = []; let p = 100; for (let i = 0; i < 300; i++) { p *= 1 + (rnd() - 0.5) * 0.04; px.push(p); }
const naiveSma = (a, n, i) => a.slice(i - n + 1, i + 1).reduce((x, y) => x + y, 0) / n;
const naiveEma = (a, n) => { const k = 2 / (n + 1); let v = naiveSma(a, n, n - 1); const o = {}; o[n - 1] = v; for (let i = n; i < a.length; i++) { v = a[i] * k + v * (1 - k); o[i] = v; } return o; };
const bb = I.bollinger(px, 20, 2); let maxErr = 0;
for (let i = 19; i < px.length; i++) { const m = naiveSma(px, 20, i); const sd = Math.sqrt(px.slice(i - 19, i + 1).reduce((x, y) => x + (y - m) ** 2, 0) / 20); maxErr = Math.max(maxErr, Math.abs(bb.upper[i] - (m + 2 * sd)), Math.abs(bb.lower[i] - (m - 2 * sd))); }
check('Bollinger(20,2) max. Abweichung', maxErr, 0, 1e-9);
const md = I.macd(px); const e12 = naiveEma(px, 12), e26 = naiveEma(px, 26); const line = []; for (let i = 25; i < px.length; i++) line.push(e12[i] - e26[i]);
const sig = naiveEma(line, 9); maxErr = 0; for (let j = 8; j < line.length; j++) maxErr = Math.max(maxErr, Math.abs(md.signal[25 + j] - sig[j]), Math.abs(md.hist[25 + j] - (line[j] - sig[j])));
check('MACD(12,26,9) max. Abweichung', maxErr, 0, 1e-9);
check('MACD erster Signalwert bei Index 33', md.signal.findIndex((v) => v !== null), 33, 0);
const bars = [{ time: 0, high: 10, low: 8, close: 9, volume: 100 }, { time: 60, high: 12, low: 9, close: 12, volume: 300 }, { time: 86400, high: 20, low: 18, close: 19, volume: 50 }];
const vw = I.vwap(bars);
check('VWAP Kerze 2 (Handrechnung 10.5)', vw[1], (9 * 100 + 11 * 300) / 400, 1e-9);
check('VWAP Reset neuer Tag (=19)', vw[2], 19, 1e-9);
const co = I.crossover([1, 2, 3, 4], [2.5, 2.5, 2.5, 2.5]);
check('crossover an Index 2', co.indexOf(1), 2, 0);
// 4) Mini-Script: Parser rechnet richtig und lehnt gefährliche Eingaben ab
const M = require('../script-engine.js');
const sb = maData.map((c, i) => ({ time: i * 86400, open: c, high: c, low: c, close: c, volume: 1 }));
const so = M.run('x = ema(close, 10)\nplot(x)\nplot((close + 1) * 2 - close * 2)', sb);
check('Mini-Script ema(close,10) = indicators.ema', so[0].values[29], e[29], 1e-12);
check('Mini-Script Punkt-vor-Strich (=2)', so[1].values[5], 2, 1e-12);
const evil = ['constructor(1)', 'close.constructor', 'toString', '__proto__ = 1', 'eval("1")', 'Function("return 1")', 'window', 'process', 'plot(ema(close, 100000))', 'a'.repeat(5000)];
let rejected = 0; for (const src of evil) { try { M.run(src, sb); } catch (err) { rejected++; } }
check(`Mini-Script lehnt ${evil.length} Angriffs-/Fehleingaben ab`, rejected, evil.length, 0);

// 5) ATR, Stochastik, SuperTrend gegen naive Zweitrechnung bzw. Handrechnung
const ob = []; let pp = 100; for (let i = 0; i < 120; i++) { const o = pp, c = pp * (1 + (rnd() - 0.5) * 0.05); ob.push({ time: i * 3600, open: o, high: Math.max(o, c) * (1 + rnd() * 0.01), low: Math.min(o, c) * (1 - rnd() * 0.01), close: c, volume: 1 }); pp = c; }
const trNaive = ob.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - ob[i - 1].close), Math.abs(b.low - ob[i - 1].close))));
let atrW = trNaive.slice(0, 14).reduce((x, y) => x + y, 0) / 14; const atrRef = { 13: atrW }; for (let i = 14; i < ob.length; i++) { atrW = (atrW * 13 + trNaive[i]) / 14; atrRef[i] = atrW; }
const at = I.atr(ob, 14); maxErr = 0; for (let i = 13; i < ob.length; i++) maxErr = Math.max(maxErr, Math.abs(at[i] - atrRef[i]));
check('ATR(14) Wilder max. Abweichung', maxErr, 0, 1e-9);
check('ATR(14) erster Wert bei Index 13', at.findIndex((v) => v !== null), 13, 0);
const st = I.stoch(ob, 14, 3, 3); maxErr = 0;
for (let i = 13; i < ob.length; i++) { const w = ob.slice(i - 13, i + 1); const hh = Math.max(...w.map((b) => b.high)), ll = Math.min(...w.map((b) => b.low)); maxErr = Math.max(maxErr, Math.abs(st.raw[i] - ((ob[i].close - ll) / (hh - ll)) * 100)); }
check('Stochastik roh %K max. Abweichung', maxErr, 0, 1e-9);
check('Stochastik %K liegt in 0–100', st.k.filter((v) => v !== null).every((v) => v >= 0 && v <= 100) ? 1 : 0, 1, 0);
// SuperTrend: Handrechnung auf einer glatten Reihe – im stetigen Anstieg Linie unter dem Kurs (dir 1), nach einem Einbruch darüber (dir -1)
const up = []; for (let i = 0; i < 60; i++) { const c = 100 + i; up.push({ time: i, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 1 }); }
for (let i = 60; i < 70; i++) { const c = 160 - (i - 59) * 8; up.push({ time: i, open: c + 4, high: c + 5, low: c - 1, close: c, volume: 1 }); }
const sup = I.supertrend(up, 10, 3);
check('SuperTrend Aufwärtstrend: Linie unter dem Kurs', sup.line[50] < up[50].close && sup.dir[50] === 1 ? 1 : 0, 1, 0);
check('SuperTrend Trendwechsel nach dem Einbruch', sup.dir[69], -1, 0);
check('SuperTrend Abwärtstrend: Linie über dem Kurs', sup.line[69] > up[69].close ? 1 : 0, 1, 0);
// 6) Backtest: Handrechnung mit zwei Trades und Gebühr
const B = require('../backtest.js');
const bb2 = [100, 100, 110, 120, 120, 90, 100, 100].map((c, i) => ({ time: i, open: c, high: c, low: c, close: c, volume: 1 }));
// Kauf-Signal auf Kerze 1 → Ausführung Eröffnung Kerze 2 (110); Verkauf-Signal Kerze 3 → Eröffnung Kerze 4 (120)
// Kauf-Signal Kerze 4 → Eröffnung Kerze 5 (90); Verkauf-Signal Kerze 6 → Eröffnung Kerze 7 (100)
const buyS = [0, 1, 0, 0, 1, 0, 0, 0], sellS = [0, 0, 0, 1, 0, 0, 1, 0];
const bt = B.backtest(bb2, buyS, sellS, { fee: 0.001 });
const t1 = (120 / 110) * (1 - 0.001) * (1 - 0.001) - 1, t2 = (100 / 90) * (1 - 0.001) * (1 - 0.001) - 1;
check('Backtest: 2 Trades', bt.stats.trades, 2, 0);
check('Backtest: Rendite Trade 1 (+8,9 % nach Gebühr)', bt.trades[0].ret, t1, 1e-12);
check('Backtest: Rendite Trade 2 (+10,9 % nach Gebühr)', bt.trades[1].ret, t2, 1e-12);
check('Backtest: Endkapital = Produkt der Trades', bt.equity[7] / 100 - 1, (1 + t1) * (1 + t2) - 1, 1e-12);
check('Backtest: Trefferquote 100 %', bt.stats.winRate, 1, 0);
check('Backtest: kein Blick in die Zukunft (Kauf erst auf Kerze 2)', bt.marks[0].i, 2, 0);
const bt0 = B.backtest(bb2, buyS.map(() => 0), sellS.map(() => 0));
check('Backtest ohne Signale: Kapital bleibt 100', bt0.equity[7], 100, 1e-12);
// 7) Mini-Script: buy/sell liefern Ausgaben vom Typ buy/sell mit Standardfarben
const sb2 = M.run('st = supertrend(10, 3)\nbuy(crossover(close, st))\nsell(crossunder(close, st))', ob);
check('Mini-Script buy()/sell() erkannt', sb2.filter((o) => o.type === 'buy' || o.type === 'sell').length, 2, 0);
// 8) Bitcoin-Dominanz: Zuordnung von Zeitreihen-Punkten auf Kerzen (je Kerze der letzte Punkt vor Kerzenschluss)
const dom = [[100, 50], [200, 52], [300, 55]]; // [Zeit, Wert]
const al = I.alignSeries(dom, [50, 100, 150, 250, 300, 999], 50);
check('alignSeries: vor dem ersten Punkt null', al[0] === null ? 1 : 0, 1, 0);
check('alignSeries: exakte Zeit trifft den Punkt', al[1], 50, 0);
check('alignSeries: zwischen zwei Punkten gilt der ältere', al[2], 50, 0);
check('alignSeries: 250 -> Wert von 200', al[3], 52, 0);
check('alignSeries: letzter Punkt', al[4], 55, 0);
check('alignSeries: nach dem Ende gilt der letzte Wert', al[5], 55, 0);
check('alignSeries: Länge = Kerzenzahl', al.length, 6, 0);
check('alignSeries: ohne Punkte nur null', I.alignSeries([], [1, 2], 1).every((v) => v === null) ? 1 : 0, 1, 0);
check('alignSeries: Punkt innerhalb der laufenden Kerze zählt (Live-Wert)', I.alignSeries([[0, 1], [150, 2]], [0, 100], 100)[1], 2, 0);
check('alignSeries: Punkt genau am Kerzenschluss gehört zur nächsten Kerze', I.alignSeries([[0, 1], [100, 2]], [0, 100], 100)[0], 1, 0);
// Zusammenführen: Tageswerte, dann Stundenwerte (feiner, ersetzen den Tagesbereich), dann der Live-Punkt
const daily = [[0, 50], [86400, 51], [172800, 52], [259200, 53]];
const hourly = [[172800, 52.1], [176400, 52.2], [180000, 52.3]];
const mg = I.mergeSeries([daily, hourly, [[190000, 52.9]]]);
check('mergeSeries: Tageswerte vor der Stundenreihe bleiben', mg[0][1] + mg[1][1], 101, 0);
check('mergeSeries: ab der ersten Stunde nur Stundenwerte', mg[2][1], 52.1, 0);
check('mergeSeries: Tageswert 259200 (innerhalb/nach Stundenbereich, aber älterer Rang) entfällt', mg.some((p) => p[0] === 259200) ? 1 : 0, 0, 0);
check('mergeSeries: Live-Punkt am Ende', mg[mg.length - 1][1], 52.9, 0);
check('mergeSeries: Gesamtlänge 6', mg.length, 6, 0);
check('mergeSeries: Live-Punkt älter als letzte Stunde wird verworfen', I.mergeSeries([hourly, [[170000, 1]]]).length, 3, 0);
check('mergeSeries: leere Teilreihen sind erlaubt', I.mergeSeries([[], daily, []]).length, 4, 0);
const md5 = [`# Testergebnis Indikatoren`, ``, `Lauf: ${new Date().toISOString()} mit Node ${process.version}, Skript tools/test_indikatoren.js`, ``,
  `Referenzen: RSI(14)- und EMA(10)-Beispielreihen aus den StockCharts-ChartSchool-Tabellen (Ergebnisse dort auf 2 Nachkommastellen gerundet, Toleranz ±0,01 bzw. ±0,005); Bollinger, MACD, ATR und Stochastik gegen eine unabhängige naive Zweitrechnung; VWAP, crossover, SuperTrend und der Backtester (backtest.js) gegen Handrechnung; Mini-Script gegen indicators.js und eine Liste von Angriffs-/Fehleingaben.`, ``,
  `Wichtige Beobachtung: Mit den auf 2 Stellen gerundeten Kursen aus dem Fließtext weicht der RSI um bis zu 0,07 Punkte ab (erster Wert 70,46 statt 70,53). Erst mit den Kursen in voller Genauigkeit (4 Nachkommastellen, wie in der Original-Tabelle) stimmen alle 19 RSI-Werte. Die Formel war richtig, die Eingabe war ungenau.`, ``,
  `**Ergebnis: ${ok} bestanden, ${fail} fehlgeschlagen.**`, ``, `| Prüfung | erwartet | berechnet | Status |`, `|---|---|---|---|`, ...rows, ``];
require('fs').writeFileSync(require('path').join(__dirname, '..', 'test-ergebnis.md'), md5.join('\n'));
console.log(`${ok} OK, ${fail} FEHLER`); rows.filter((x) => x.includes('FEHLER')).forEach((x) => console.log(x));
process.exit(fail ? 1 : 0);
