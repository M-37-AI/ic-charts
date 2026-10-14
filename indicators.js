/*
 * indicators.js – eigene Implementierung der Chart-Indikatoren (Niko-Sarge-Nachbau).
 * Keine fremde Quelle übernommen; Formeln nach den Lehrbuch-Definitionen
 * (J. Welles Wilder 1978 für RSI, Gerald Appel für MACD, John Bollinger für Bänder).
 *
 * Konventionen:
 *  - Jede Funktion bekommt ein Array von Zahlen (eine "Reihe", z. B. Schlusskurse)
 *    und liefert ein gleich langes Array zurück.
 *  - Wo noch nicht genug Daten für einen Wert vorliegen ("Aufwärmphase"), steht null.
 *  - Eingaben dürfen selbst null am Anfang enthalten (z. B. ema(rsi(close,14), 9));
 *    gerechnet wird dann ab dem ersten gültigen Wert.
 *  - Läuft im Browser (window.Indicators) und in Node (module.exports) für die Tests.
 */
(function (root) {
  'use strict';

  const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);

  /** Index des ersten gültigen (nicht-null) Wertes */
  function firstValid(src) {
    for (let i = 0; i < src.length; i++) if (isNum(src[i])) return i;
    return src.length;
  }

  /**
   * SMA – einfacher gleitender Durchschnitt
   *   SMA_t = (x_t + x_{t-1} + ... + x_{t-n+1}) / n
   * Gleitende Summe: O(n) statt O(n*len).
   */
  function sma(src, n) {
    const out = new Array(src.length).fill(null);
    let sum = 0, count = 0;
    for (let i = 0; i < src.length; i++) {
      if (!isNum(src[i])) { sum = 0; count = 0; continue; } // Lücke: neu starten
      sum += src[i]; count++;
      if (count > n) { sum -= src[i - n]; count = n; }
      if (count === n) out[i] = sum / n;
    }
    return out;
  }

  /**
   * EMA – exponentieller gleitender Durchschnitt
   *   alpha = 2 / (n + 1)
   *   EMA_t = alpha * x_t + (1 - alpha) * EMA_{t-1}
   * Startwert (Seed) = SMA der ersten n Werte (wie bei StockCharts / den meisten Plattformen).
   */
  function ema(src, n) {
    return expSmooth(src, n, 2 / (n + 1));
  }

  /**
   * RMA – Wilders Glättung ("Smoothed Moving Average"), alpha = 1/n.
   *   RMA_t = (RMA_{t-1} * (n - 1) + x_t) / n
   * Wird für RSI und ATR verwendet.
   */
  function rma(src, n) {
    return expSmooth(src, n, 1 / n);
  }

  function expSmooth(src, n, alpha) {
    const out = new Array(src.length).fill(null);
    const start = firstValid(src);
    if (src.length - start < n) return out;
    let seed = 0;
    for (let i = start; i < start + n; i++) seed += src[i];
    let prev = seed / n;
    out[start + n - 1] = prev;
    for (let i = start + n; i < src.length; i++) {
      if (!isNum(src[i])) { out[i] = prev; continue; } // Lücke: letzten Wert halten
      prev = alpha * src[i] + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }

  /**
   * Standardabweichung über n Werte (Grundgesamtheit, Teiler n – so definiert
   * John Bollinger seine Bänder).
   *   sigma = sqrt( sum((x - mittel)^2) / n )
   */
  function stdev(src, n) {
    const out = new Array(src.length).fill(null);
    const mean = sma(src, n);
    for (let i = 0; i < src.length; i++) {
      if (!isNum(mean[i])) continue;
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += (src[j] - mean[i]) ** 2;
      out[i] = Math.sqrt(s / n);
    }
    return out;
  }

  /**
   * Bollinger-Bänder (Standard 20, 2)
   *   Mitte = SMA(n), Oben = Mitte + k*sigma, Unten = Mitte - k*sigma
   */
  function bollinger(src, n = 20, k = 2) {
    const mid = sma(src, n), sd = stdev(src, n);
    const upper = mid.map((m, i) => (isNum(m) ? m + k * sd[i] : null));
    const lower = mid.map((m, i) => (isNum(m) ? m - k * sd[i] : null));
    return { mid, upper, lower };
  }

  /**
   * RSI – Relative-Stärke-Index nach Wilder (Standard 14)
   *   Veränderung d_t = x_t - x_{t-1}
   *   Gewinn g_t = max(d_t, 0), Verlust l_t = max(-d_t, 0)
   *   Durchschnittsgewinn/-verlust: erster Wert = einfacher Schnitt der ersten n
   *   Veränderungen, danach Wilder-Glättung (RMA): avg_t = (avg_{t-1}*(n-1) + g_t)/n
   *   RS = avgGewinn / avgVerlust, RSI = 100 - 100 / (1 + RS)
   * Der erste RSI-Wert steht also beim Index n (braucht n+1 Kurse).
   */
  function rsi(src, n = 14) {
    const out = new Array(src.length).fill(null);
    const gains = new Array(src.length).fill(null);
    const losses = new Array(src.length).fill(null);
    for (let i = 1; i < src.length; i++) {
      if (!isNum(src[i]) || !isNum(src[i - 1])) continue;
      const d = src[i] - src[i - 1];
      gains[i] = d > 0 ? d : 0;
      losses[i] = d < 0 ? -d : 0;
    }
    const ag = rma(gains, n), al = rma(losses, n);
    for (let i = 0; i < src.length; i++) {
      if (!isNum(ag[i]) || !isNum(al[i])) continue;
      if (al[i] === 0) out[i] = ag[i] === 0 ? 50 : 100;
      else out[i] = 100 - 100 / (1 + ag[i] / al[i]);
    }
    return out;
  }

  /**
   * MACD (Standard 12, 26, 9) nach Gerald Appel
   *   MACD-Linie  = EMA(12) - EMA(26)
   *   Signallinie = EMA(9) der MACD-Linie
   *   Histogramm  = MACD-Linie - Signallinie
   */
  function macd(src, fast = 12, slow = 26, signal = 9) {
    const ef = ema(src, fast), es = ema(src, slow);
    const line = ef.map((v, i) => (isNum(v) && isNum(es[i]) ? v - es[i] : null));
    const sig = ema(line, signal);
    const hist = line.map((v, i) => (isNum(v) && isNum(sig[i]) ? v - sig[i] : null));
    return { macd: line, signal: sig, hist };
  }

  /**
   * VWAP – volumengewichteter Durchschnittspreis
   *   typischer Preis TP = (Hoch + Tief + Schluss) / 3
   *   VWAP_t = Summe(TP * Volumen) / Summe(Volumen), seit Beginn der Sitzung
   * bars: [{time (Unix-Sekunden), high, low, close, volume}]
   * sessionKey: Funktion time -> Schlüssel; wechselt der Schlüssel, beginnt die Summe neu
   *            (Standard: UTC-Kalendertag).
   */
  function vwap(bars, sessionKey = (t) => Math.floor(t / 86400)) {
    const out = new Array(bars.length).fill(null);
    let pv = 0, vol = 0, key = null;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i], k = sessionKey(b.time);
      if (k !== key) { pv = 0; vol = 0; key = k; }
      const tp = (b.high + b.low + b.close) / 3;
      pv += tp * b.volume; vol += b.volume;
      out[i] = vol > 0 ? pv / vol : tp;
    }
    return out;
  }

  /** Höchster / tiefster Wert der letzten n Werte */
  function highest(src, n) { return windowFn(src, n, (a) => Math.max(...a)); }
  function lowest(src, n) { return windowFn(src, n, (a) => Math.min(...a)); }
  function windowFn(src, n, f) {
    const out = new Array(src.length).fill(null);
    for (let i = n - 1; i < src.length; i++) {
      const w = src.slice(i - n + 1, i + 1);
      if (w.every(isNum)) out[i] = f(w);
    }
    return out;
  }

  /**
   * crossover(a, b): wahr (1) an der Kerze, an der a über b steigt:
   *   a_t > b_t  und  a_{t-1} <= b_{t-1}
   * crossunder: umgekehrt. Ergebnis 1/0, null in der Aufwärmphase.
   */
  function crossover(a, b) {
    return a.map((v, i) => (i > 0 && [v, b[i], a[i - 1], b[i - 1]].every(isNum)
      ? (v > b[i] && a[i - 1] <= b[i - 1] ? 1 : 0) : null));
  }
  function crossunder(a, b) {
    return a.map((v, i) => (i > 0 && [v, b[i], a[i - 1], b[i - 1]].every(isNum)
      ? (v < b[i] && a[i - 1] >= b[i - 1] ? 1 : 0) : null));
  }

  /**
   * ATR – Average True Range nach Wilder (Standard 14)
   *   TR_t = max(Hoch - Tief, |Hoch - Schluss_{t-1}|, |Tief - Schluss_{t-1}|)
   *   ATR  = RMA(TR, n)
   */
  function atr(bars, n = 14) {
    const tr = bars.map((b, i) => (i === 0 ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
    return rma(tr, n);
  }

  /**
   * Stochastik (Standard 14, 3, 3) nach George Lane
   *   roh%K = (Schluss - tiefstes Tief_n) / (höchstes Hoch_n - tiefstes Tief_n) * 100
   *   %K = SMA(roh%K, k), %D = SMA(%K, d)
   */
  function stoch(bars, n = 14, k = 3, d = 3) {
    const hh = highest(bars.map((b) => b.high), n), ll = lowest(bars.map((b) => b.low), n);
    const raw = bars.map((b, i) => (isNum(hh[i]) ? (hh[i] === ll[i] ? 50 : ((b.close - ll[i]) / (hh[i] - ll[i])) * 100) : null));
    const K = sma(raw, k);
    return { raw, k: K, d: sma(K, d) };
  }

  /**
   * SuperTrend (Standard 10, 3)
   *   Basisbänder: hl2 ± mult * ATR(n)
   *   Endbänder ziehen nur in Trendrichtung nach (oberes nur runter, unteres nur rauf),
   *   solange der Vorschluss sie nicht verlassen hat.
   *   Trend wechselt, wenn der Schluss das gegenüberliegende Endband durchbricht.
   *   Linie = unteres Band im Aufwärtstrend (dir = 1), oberes im Abwärtstrend (dir = -1).
   */
  function supertrend(bars, n = 10, mult = 3) {
    const a = atr(bars, n), N = bars.length;
    const line = new Array(N).fill(null), dir = new Array(N).fill(null);
    let fu = null, fl = null, trend = 1;
    for (let i = 0; i < N; i++) {
      if (!isNum(a[i])) continue;
      const mid = (bars[i].high + bars[i].low) / 2;
      const bu = mid + mult * a[i], bl = mid - mult * a[i];
      const pc = i > 0 ? bars[i - 1].close : bars[i].close;
      if (fu === null) { fu = bu; fl = bl; }
      else { fu = bu < fu || pc > fu ? bu : fu; fl = bl > fl || pc < fl ? bl : fl; }
      if (trend === 1 && bars[i].close < fl) trend = -1;
      else if (trend === -1 && bars[i].close > fu) trend = 1;
      line[i] = trend === 1 ? fl : fu; dir[i] = trend;
    }
    return { line, dir };
  }


  /**
   * Zeitreihen-Punkte [[zeit, wert], …] (aufsteigend) auf Kerzen legen: je Kerze gilt der letzte Punkt
   * vor ihrem Schluss (zeit < kerzenzeit + step), also auch ein Live-Wert innerhalb der laufenden Kerze.
   * Vor dem ersten Punkt null. Genutzt für die Bitcoin-Dominanz.
   */
  function alignSeries(points, times, step) {
    const out = new Array(times.length).fill(null);
    let j = 0;
    for (let i = 0; i < times.length; i++) {
      const end = times[i] + step;
      while (j + 1 < points.length && points[j + 1][0] < end) j++;
      out[i] = points.length && points[j][0] < end ? points[j][1] : null;
    }
    return out;
  }
  /**
   * Mehrere Zeitreihen zu einer zusammenführen; spätere Reihen sind feiner/aktueller und haben Vorrang:
   * jede Reihe ersetzt alles ab ihrem ersten Zeitpunkt. Liegt sie komplett vor dem bisherigen Anfang, entfällt sie.
   */
  function mergeSeries(series) {
    let out = [];
    for (const s of series) {
      if (!s || !s.length) continue;
      if (out.length && s[s.length - 1][0] < out[0][0]) continue; // liegt komplett vor dem Bisherigen: veraltet
      const start = s[0][0];
      out = out.filter((p) => p[0] < start).concat(s);
    }
    return out;
  }

  const api = { alignSeries, mergeSeries, sma, ema, rma, stdev, bollinger, rsi, macd, vwap, highest, lowest, crossover, crossunder, atr, stoch, supertrend, isNum };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Indicators = api;
})(typeof window !== 'undefined' ? window : globalThis);
