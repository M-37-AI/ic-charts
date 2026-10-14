/*
 * drawings.js – eigene Zeichenebene für Lightweight Charts (Plugin-Schnittstelle "Series Primitive").
 *
 * Figuren werden in Kerzenindex + Preis gespeichert und bei jedem Bild in Pixel umgerechnet,
 * dadurch wandern sie beim Scrollen und Zoomen mit dem Chart.
 *
 *  - fib: Fibonacci-Retracement zwischen zwei Punkten. Ebene 0 liegt am zweiten Punkt,
 *         Ebene 1 am ersten (so wie es Charting-Programme üblicherweise halten).
 *         Preis(Ebene) = b + (a − b) · Ebene
 *  - pos: Position mit Einstieg, Ziel und Stop. Ziel über dem Einstieg = Long, darunter = Short.
 *         Chance-Risiko-Verhältnis CRV = |Ziel − Einstieg| / |Einstieg − Stop|
 */
(function (root) {
  'use strict';
  const LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const EXT = [1.272, 1.618];

  class Layer {
    constructor(opts) {
      this.o = Object.assign({ up: '#3ddc97', down: '#ff6b7a', accent: '#f5b942', text: '#e7e9ee', muted: '#8b93a1', font: '11px "JetBrains Mono", Menlo, monospace', fmt: (v) => String(v) }, opts);
      this.shapes = []; this.pending = null;
      this.view = new PaneView(this); this.views = [this.view];
    }
    attached({ chart, series, requestUpdate }) { this.chart = chart; this.series = series; this.req = requestUpdate; }
    detached() { this.chart = null; this.series = null; }
    updateAllViews() { this.view.update(); }
    paneViews() { return this.views; }
    add(shape) { this.shapes.push(shape); this.req && this.req(); }
    setPending(shape) { this.pending = shape; this.req && this.req(); }
    removeLast() { const s = this.shapes.pop(); this.req && this.req(); return s; }
    clear() { this.shapes = []; this.pending = null; this.req && this.req(); }
    x(idx) { return this.chart.timeScale().logicalToCoordinate(idx); }
    y(price) { return this.series.priceToCoordinate(price); }
  }

  class PaneView {
    constructor(layer) { this.l = layer; this.items = []; }
    zOrder() { return 'top'; }
    update() {
      const l = this.l; this.items = [];
      if (!l.chart || !l.series) return;
      const all = l.pending ? [...l.shapes, Object.assign({ pending: true }, l.pending)] : l.shapes;
      for (const s of all) {
        if (s.type === 'fib' && s.a && s.b) this.items.push(this.fib(s));
        else if (s.type === 'pos' && s.entry) this.items.push(this.pos(s));
        else if (s.type === 'line' && s.a && s.b) this.items.push({ kind: 'line', x0: l.x(s.a.idx), y0: l.y(s.a.price), x1: l.x(s.b.idx), y1: l.y(s.b.price), extend: !!s.extend, dashed: !!s.dashed, label: s.label || '', tone: s.kind || 'trend', pending: !!s.pending });
        else if (s.type === 'level') this.items.push({ kind: 'level', x0: l.x(s.idx0 ?? 0), y: l.y(s.price), label: s.label || '', tone: s.kind || 'neutral', price: s.price });
        else if (s.type === 'zone') this.items.push({ kind: 'zone', x0: l.x(s.idx0), x1: l.x(s.idx1), y0: l.y(s.p1), y1: l.y(s.p2), label: s.label || '', tone: s.kind || 'neutral' });
        else if (s.type === 'poly' && s.pts?.length) this.items.push({ kind: 'poly', pts: s.pts.map((p) => ({ x: l.x(p.idx), y: l.y(p.price) })), closed: !!s.closed, label: s.label || '', tone: s.kind || 'pattern' });
        else if (s.type === 'note') this.items.push({ kind: 'note', x: l.x(s.idx), y: l.y(s.price), text: s.text || '', tone: s.kind || 'neutral', above: s.above !== false });
      }
    }
    fib(s) {
      const l = this.l;
      const x0 = Math.min(l.x(s.a.idx), l.x(s.b.idx)), x1 = Math.max(l.x(s.a.idx), l.x(s.b.idx));
      const levels = [...LEVELS, ...EXT].map((lv) => { const p = s.b.price + (s.a.price - s.b.price) * lv; return { lv, p, y: l.y(p), ext: lv > 1 }; });
      return { kind: 'fib', x0, x1, levels, pending: !!s.pending };
    }
    pos(s) {
      const l = this.l;
      const target = s.target ?? s.entry, stop = s.stop ?? s.entry;
      const idx1 = Math.max(s.idx0, s.idx1 ?? s.idx0) + 4;
      return {
        kind: 'pos', pending: !!s.pending, long: target.price >= s.entry.price,
        x0: l.x(s.idx0), x1: l.x(idx1), ye: l.y(s.entry.price), yt: l.y(target.price), ys: l.y(stop.price),
        entry: s.entry.price, target: target.price, stop: stop.price,
      };
    }
    renderer() { return new Renderer(this.l, this.items); }
  }

  class Renderer {
    constructor(layer, items) { this.l = layer; this.items = items; }
    draw(target) {
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        const o = this.l.o, W = mediaSize.width;
        ctx.save(); ctx.font = o.font; ctx.textBaseline = 'middle';
        for (const it of this.items) {
          ctx.globalAlpha = it.pending ? 0.7 : 1;
          if (it.kind === 'fib') this.drawFib(ctx, it, o, W);
          else if (it.kind === 'pos') this.drawPos(ctx, it, o, W);
          else if (it.kind === 'line') this.drawLine(ctx, it, o, W);
          else if (it.kind === 'level') this.drawLevel(ctx, it, o, W);
          else if (it.kind === 'zone') this.drawZone(ctx, it, o, W);
          else if (it.kind === 'poly') this.drawPoly(ctx, it, o, W);
          else if (it.kind === 'note') this.drawNote(ctx, it, o, W);
        }
        ctx.restore();
      });
    }
    tone(o, t) { return { support: o.up, resistance: o.down, trend: o.accent, neutral: '#5ad7e6', pattern: '#b8a2ff', bull: o.up, bear: o.down }[t] || '#5ad7e6'; }
    // Linie zwischen zwei Punkten, optional nach rechts verlängert (Strahl); Beschriftung am Endpunkt
    drawLine(ctx, it, o, W) {
      if (![it.x0, it.y0, it.x1, it.y1].every(isFinite)) return;
      const c = this.tone(o, it.tone);
      let ex = it.x1, ey = it.y1;
      if (it.extend && it.x1 !== it.x0) { const k = (it.y1 - it.y0) / (it.x1 - it.x0); ex = W; ey = it.y1 + k * (W - it.x1); }
      ctx.strokeStyle = c; ctx.lineWidth = 1.6; ctx.setLineDash(it.dashed ? [6, 4] : []);
      ctx.beginPath(); ctx.moveTo(it.x0, it.y0); ctx.lineTo(it.x1, it.y1); ctx.stroke();
      if (it.extend) { ctx.globalAlpha *= 0.55; ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(ex, ey); ctx.stroke(); ctx.globalAlpha /= 0.55; }
      ctx.setLineDash([]);
      [[it.x0, it.y0], [it.x1, it.y1]].forEach(([x, y]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); });
      if (it.label) { // am Endpunkt; nahe am rechten Rand lieber über der Linienmitte, damit Niveau-Beschriftungen frei bleiben
        const nearEdge = it.x1 + 160 > W;
        const lx = nearEdge ? (it.x0 + it.x1) / 2 - ctx.measureText(it.label).width / 2 - 5 : it.x1 + 8, ly = nearEdge ? (it.y0 + it.y1) / 2 - 12 : it.y1 - 12;
        this.label(ctx, it.label, Math.max(4, lx), ly, c, 'rgba(21,23,28,0.88)');
      }
    }
    // Waagerechtes Niveau (Unterstützung / Widerstand) ab einem Punkt bis zum rechten Rand
    drawLevel(ctx, it, o, W) {
      if (!isFinite(it.y)) return;
      const c = this.tone(o, it.tone), x0 = isFinite(it.x0) ? Math.max(0, it.x0) : 0;
      ctx.fillStyle = c + '18'; ctx.fillRect(x0, it.y - 3, W - x0, 6);
      ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x0, it.y); ctx.lineTo(W, it.y); ctx.stroke();
      const txt = `${it.label ? it.label + '  ' : ''}${o.fmt(it.price)}`;
      this.label(ctx, txt, W - 8, it.y - 11, c, 'rgba(21,23,28,0.88)', 'right');
    }
    // Zone zwischen zwei Preisen (Angebot / Nachfrage, Konsolidierung)
    drawZone(ctx, it, o, W) {
      if (![it.x0, it.x1, it.y0, it.y1].every(isFinite)) return;
      const c = this.tone(o, it.tone), x = Math.min(it.x0, it.x1), w = Math.abs(it.x1 - it.x0), y = Math.min(it.y0, it.y1), h = Math.abs(it.y1 - it.y0);
      ctx.fillStyle = c + '22'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.setLineDash([]);
      if (it.label) this.label(ctx, it.label, x + 6, y + 10, c, 'rgba(21,23,28,0.88)');
    }
    // Muster: Linienzug durch mehrere Punkte (Dreieck, Kopf-Schulter, Kanal …), Beschriftung in der Mitte
    drawPoly(ctx, it, o, W) {
      const pts = it.pts.filter((p) => isFinite(p.x) && isFinite(p.y)); if (pts.length < 2) return;
      const c = this.tone(o, it.tone);
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (it.closed) ctx.closePath();
      if (it.closed) { ctx.fillStyle = c + '1c'; ctx.fill(); }
      ctx.strokeStyle = c; ctx.lineWidth = 1.6; ctx.setLineDash([]); ctx.stroke();
      pts.forEach((p) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); });
      if (it.label) { const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, top = Math.min(...pts.map((p) => p.y)); ctx.font = 'bold ' + o.font; this.label(ctx, it.label, cx - ctx.measureText(it.label).width / 2 - 5, top - 14, '#1a1405', c); ctx.font = o.font; }
    }
    // Notiz mit Zeiger an einem Punkt
    drawNote(ctx, it, o, W) {
      if (!isFinite(it.x) || !isFinite(it.y)) return;
      const c = this.tone(o, it.tone), dy = it.above ? -22 : 22;
      ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(it.x, it.y + dy); ctx.stroke();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(it.x, it.y, 3, 0, Math.PI * 2); ctx.fill();
      const w = ctx.measureText(it.text).width + 10, lx = Math.max(4, Math.min(W - w - 4, it.x - w / 2));
      this.label(ctx, it.text, lx, it.y + dy + (it.above ? -8 : 8), '#e7e9ee', 'rgba(34,38,46,0.95)');
      ctx.strokeStyle = c; ctx.strokeRect(lx + 0.5, it.y + dy + (it.above ? -16 : 0) + 0.5, w, 16);
    }
    label(ctx, text, x, y, color, bg, align = 'left') {
      const w = ctx.measureText(text).width + 10, h = 16;
      const lx = align === 'left' ? x : x - w;
      ctx.fillStyle = bg; this.round(ctx, lx, y - h / 2, w, h, 4); ctx.fill();
      ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.fillText(text, lx + 5, y + 0.5);
    }
    round(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    drawFib(ctx, it, o, W) {
      const { x0, x1, levels } = it; if (!isFinite(x0) || !isFinite(x1)) return;
      const colors = ['#8b93a1', '#ff6b7a', '#f5b942', '#3ddc97', '#5ad7e6', '#b8a2ff', '#8b93a1', '#ff9f43', '#ff9f43'];
      // Bänder zwischen den Ebenen 0…1
      for (let k = 0; k < LEVELS.length - 1; k++) {
        const a = levels[k], b = levels[k + 1]; if (!isFinite(a.y) || !isFinite(b.y)) continue;
        ctx.fillStyle = colors[k + 1] + '14'; ctx.fillRect(x0, Math.min(a.y, b.y), x1 - x0, Math.abs(b.y - a.y));
      }
      levels.forEach((L, k) => {
        if (!isFinite(L.y)) return;
        ctx.strokeStyle = colors[k]; ctx.lineWidth = L.lv === 0 || L.lv === 1 ? 1.5 : 1;
        ctx.setLineDash(L.ext ? [4, 4] : []);
        ctx.beginPath(); ctx.moveTo(x0, L.y); ctx.lineTo(x1, L.y); ctx.stroke(); ctx.setLineDash([]);
        this.label(ctx, `${L.lv.toFixed(3).replace('.', ',')}  ${o.fmt(L.p)}`, x1 + 6, L.y, colors[k], 'rgba(21,23,28,0.85)');
      });
      // senkrechte Begrenzung der Strecke
      ctx.strokeStyle = 'rgba(139,147,161,0.5)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      const yTop = Math.min(levels[0].y, levels[6].y), yBot = Math.max(levels[0].y, levels[6].y);
      ctx.beginPath(); ctx.moveTo(x0, yTop); ctx.lineTo(x0, yBot); ctx.moveTo(x1, yTop); ctx.lineTo(x1, yBot); ctx.stroke(); ctx.setLineDash([]);
    }
    drawPos(ctx, it, o, W) {
      const { x0, x1, ye, yt, ys, entry, target, stop, long } = it;
      if (![x0, x1, ye, yt, ys].every(isFinite)) return;
      const w = x1 - x0;
      // Zielzone grün, Risikozone rot
      ctx.fillStyle = o.up + '26'; ctx.fillRect(x0, Math.min(ye, yt), w, Math.abs(yt - ye));
      ctx.fillStyle = o.down + '26'; ctx.fillRect(x0, Math.min(ye, ys), w, Math.abs(ys - ye));
      const line = (y, color, width, dash) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]); };
      line(yt, o.up, 1.5); line(ys, o.down, 1.5); line(ye, o.accent, 1.5, [5, 4]);
      ctx.strokeStyle = 'rgba(231,233,238,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, Math.min(yt, ys) + 0.5, w, Math.abs(yt - ys));
      const pct = (p) => `${p >= 0 ? '+' : ''}${(p * 100).toFixed(2).replace('.', ',')} %`;
      const gain = (target - entry) / entry, risk = (stop - entry) / entry;
      const crv = Math.abs(entry - stop) > 0 ? Math.abs(target - entry) / Math.abs(entry - stop) : null;
      this.label(ctx, `Ziel ${o.fmt(target)}  ${pct(gain)}`, x1 + 6, yt, o.up, 'rgba(21,23,28,0.85)');
      this.label(ctx, `Stop ${o.fmt(stop)}  ${pct(risk)}`, x1 + 6, ys, o.down, 'rgba(21,23,28,0.85)');
      this.label(ctx, `Einstieg ${o.fmt(entry)}`, x1 + 6, ye, o.accent, 'rgba(21,23,28,0.85)');
      const head = `${long ? 'LONG' : 'SHORT'}${crv !== null ? ` · CRV 1 : ${crv.toFixed(2).replace('.', ',')}` : ''}`;
      ctx.font = 'bold ' + o.font; this.label(ctx, head, x0 + 6, Math.min(yt, ys) - 12, '#1a1405', long ? o.up : o.down); ctx.font = o.font;
    }
  }

  const api = { Layer, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Drawings = api;
})(typeof window !== 'undefined' ? window : globalThis);
