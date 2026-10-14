/*
 * server.mjs – Claude im Chart.
 *
 * Kleiner lokaler Server: liefert die Chart-App (Ordner darüber) und spricht unter /agent per WebSocket
 * mit dem Browser. Jede Nutzereingabe wird mit dem Claude Agent SDK (dem Kern von Claude Code) als
 * query() ausgeführt. Die Chart-Werkzeuge sind beim SDK als In-Process-MCP-Server angemeldet; ihre
 * Ausführung passiert im Browser (agent-panel.js): tool_call → Browser → tool_result.
 *
 * Start:  cd agent && npm install && npm start      (Node 18+, Anmeldung siehe README)
 * Umgebung: PORT (8787), CLAUDE_MODEL (claude-opus-5-5), AGENT_MOCK=1 (Probelauf ohne Claude)
 * Eine Datei agent/.env wird, falls vorhanden, als KEY=WERT in die Umgebung übernommen.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
// .env (optional) – wird nur vom Server gelesen
try {
  for (const line of fs.readFileSync(path.join(here, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* keine .env */ }
const PORT = +(process.env.PORT || 8787);
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const MOCK = process.env.AGENT_MOCK === '1';

// ---------------- Statische Dateien ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml' };
// Bitcoin-Dominanz: der Website-Endpunkt von CoinMarketCap (ohne Schlüssel) sendet keinen CORS-Header,
// darum holt der Server sie und reicht sie als [[zeit, wert], …] weiter; 10 Minuten zwischengespeichert.
const DOM_URL = 'https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical';
let domCache = { at: 0, body: null };
async function dominanz() {
  if (Date.now() - domCache.at < 600e3 && domCache.body) return domCache.body;
  const jetzt = Math.floor(Date.now() / 1000), out = {};
  for (const [name, iv, tage, schritt] of [['tage', '1d', 3 * 365, 86400], ['stunden', '1h', 30, 3600]]) {
    const r = await fetch(`${DOM_URL}?timeStart=${jetzt - tage * 86400}&timeEnd=${jetzt}&interval=${iv}&convertId=2781`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15e3) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const m = new Map();
    for (const q of (await r.json()).data.quotes) m.set(Math.floor(Date.parse(q.timestamp) / 1000 / schritt) * schritt, Math.round(q.btcDominance * 100) / 100);
    out[name] = [...m.entries()].sort((a, b) => a[0] - b[0]);
  }
  out.stand = new Date().toISOString();
  domCache = { at: Date.now(), body: JSON.stringify(out) };
  return domCache.body;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/dominanz') {
    return dominanz().then((body) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); res.end(body); })
      .catch((e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })); });
  }
  let p = path.normalize(decodeURIComponent(u.pathname)); if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}agent${path.sep}.env`)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------------- Werkzeuge: Definition hier, Ausführung im Browser ----------------
const num = (d) => z.number().describe(d);
const TOOL_DEFS = [
  ['get_state', 'Aktueller Zustand des Charts: Symbol, Zeiteinheit, letzter Kurs, letzte Kerze, eingeschaltete Indikatoren und ihre aktuellen Werte, Alarme, Zeichnungen, Script und Backtest-Kennzahlen. Zuerst aufrufen, bevor du etwas über den Chart sagst.', {}, true],
  ['get_bars', 'Die letzten N Kerzen (OHLCV, RSI 14, EMA 21) als Tabelle. Höchstens 500.', { count: num('Anzahl Kerzen, Standard 50').optional() }, true],
  ['find_extremes', 'Höchstes Hoch und tiefstes Tief der letzten N Kerzen mit Zeit und Abstand in Kerzen. Praktisch als Grundlage für Fibonacci oder Positionen.', { lookback: num('Anzahl Kerzen zurück, Standard 100').optional() }, true],
  ['screenshot', 'Liefert den Kurschart als PNG-Bild, damit du die Struktur sehen kannst (Kerzen, Indikatoren, Zeichnungen).', {}, true],
  ['set_symbol', 'Wechselt das Symbol. Krypto live: BTCUSDT, ETHUSDT, SOLUSDT und andere Binance-Paare; Aktien (Schnappschuss): AAPL, NVDA, MSFT, SAP.', { symbol: z.string().describe('z. B. ETHUSDT') }, false],
  ['set_timeframe', 'Wechselt die Zeiteinheit.', { timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']) }, false],
  ['set_indicators', 'Schaltet Indikatoren ein oder aus. Nur die genannten werden geändert.', { sma: z.boolean().optional(), ema: z.boolean().optional(), bb: z.boolean().optional(), vwap: z.boolean().optional(), st: z.boolean().describe('SuperTrend').optional(), rsi: z.boolean().optional(), macd: z.boolean().optional(), btcd: z.boolean().describe('Bitcoin-Dominanz (BTC.D) als Panel').optional() }, false],
  ['run_script', 'Führt ein Mini-Script aus (eigene Formelsprache, kein JavaScript). Reihen: close open high low volume hl2 hlc3. Funktionen: sma(x,n) ema(x,n) rma(x,n) rsi(x,n) stdev(x,n) highest(x,n) lowest(x,n) bbupper(x,n,k) bblower(x,n,k) macd(x) macdsignal(x) macdhist(x) vwap() atr(n) stoch(n,k) stochd(n,k,d) supertrend(n,mult) crossover(a,b) crossunder(a,b) change(x,n) abs max min. Ausgaben je Zeile: plot(x,"farbe","Titel") im Kurschart, panel(x) unten, alert(bedingung,"Text") markiert Signale, hline(preis), buy(bedingung) und sell(bedingung) starten einen Backtest (nur long, nächste Eröffnung, 0,1 % Gebühr). Variablen: name = ausdruck. Operatoren + - * / > < >= <= == != and or not. Kommentare mit //. Beispiel: schnell = ema(close, 9)\\nlangsam = ema(close, 21)\\nplot(schnell, "orange")\\nbuy(crossover(schnell, langsam))\\nsell(crossunder(schnell, langsam))', { code: z.string().describe('Der Script-Text, Zeilen mit \\n getrennt') }, false],
  ['clear_script', 'Entfernt das Mini-Script und seine Zeichnungen.', {}, false],
  ['add_alarm', 'Setzt einen Preisalarm. Löst mit Ton aus, wenn der Live-Kurs den Preis kreuzt.', { price: num('Preis') }, false],
  ['add_hline', 'Zeichnet eine horizontale Linie bei einem Preis.', { price: num('Preis') }, false],
  ['draw_fibonacci', 'Zeichnet ein Fibonacci-Retracement zwischen zwei Punkten. Ebene 1 liegt am Startpunkt, Ebene 0 am Endpunkt. Punkte per Zeit (ISO) oder Abstand in Kerzen; ohne Preis wird der Schlusskurs der Kerze genommen – für Hoch/Tief den Preis aus find_extremes mitgeben.', { from_time: z.string().optional(), from_bars_ago: num('Startpunkt: Kerzen zurück').optional(), from_price: num('Preis am Startpunkt').optional(), to_time: z.string().optional(), to_bars_ago: num('Endpunkt: Kerzen zurück').optional(), to_price: num('Preis am Endpunkt').optional() }, false],
  ['draw_position', 'Zeichnet eine Position mit Einstieg, Ziel und Stop (Ziel über Einstieg = Long, darunter = Short) und berechnet das Chance-Risiko-Verhältnis.', { entry: num('Einstiegspreis'), target: num('Zielpreis'), stop: num('Stop-Preis'), bars_ago: num('Startkerze: Kerzen zurück, Standard 0').optional() }, false],
  ['clear_drawings', 'Löscht alle Zeichnungen, Linien und Alarme.', {}, false],
  ['undo_drawing', 'Entfernt die zuletzt gezeichnete Figur.', {}, false],
  ['find_pivots', 'Wendepunkte (Swing-Hochs und -Tiefs) der letzten N Kerzen mit Preis und Abstand in Kerzen. Grundlage für Trendlinien, Unterstützungen, Widerstände und Muster: Linien immer durch echte Wendepunkte legen.', { lookback: num('Kerzen zurück, Standard 200').optional(), strength: num('Kerzen links und rechts, die der Punkt überragen muss, Standard 5').optional() }, true],
  ['draw_line', 'Zeichnet eine beschriftete Linie durch zwei Punkte (Kerzen zurück + Preis), z. B. eine Trendlinie durch zwei Tiefs. extend_right verlängert sie als Strahl nach rechts.', { from_bars_ago: num('Startpunkt: Kerzen zurück'), from_price: num('Preis am Startpunkt'), to_bars_ago: num('Endpunkt: Kerzen zurück'), to_price: num('Preis am Endpunkt'), extend_right: z.boolean().optional(), label: z.string().describe('kurze Beschriftung, z. B. "Aufwärtstrend"').optional(), kind: z.enum(['trend', 'support', 'resistance', 'neutral', 'bull', 'bear']).optional(), dashed: z.boolean().optional() }, false],
  ['draw_level', 'Zeichnet ein waagerechtes Niveau (Unterstützung oder Widerstand) ab einem Punkt bis zum rechten Rand, beschriftet und mit Preis.', { price: num('Preis'), label: z.string().optional(), kind: z.enum(['support', 'resistance', 'neutral']).optional(), from_bars_ago: num('ab welcher Kerze, Standard 150').optional() }, false],
  ['draw_zone', 'Zeichnet eine Zone zwischen zwei Preisen (Angebot/Nachfrage, Konsolidierung, Lücke).', { price_low: num('unterer Preis'), price_high: num('oberer Preis'), from_bars_ago: num('Beginn: Kerzen zurück, Standard 150').optional(), to_bars_ago: num('Ende: Kerzen zurück, Standard 0').optional(), label: z.string().optional(), kind: z.enum(['support', 'resistance', 'neutral', 'bull', 'bear']).optional() }, false],
  ['draw_pattern', 'Zeichnet ein Chartmuster als Linienzug durch mehrere Punkte mit Beschriftung in der Mitte, z. B. Dreieck (closed), Kopf-Schulter (5 Punkte), Kanal, Doppelboden. Punkte aus find_pivots nehmen.', { points: z.array(z.object({ bars_ago: z.number(), price: z.number() })).min(2).max(12), label: z.string().describe('z. B. "Kopf-Schulter"'), closed: z.boolean().describe('Linienzug schließen und füllen').optional(), kind: z.enum(['pattern', 'bull', 'bear', 'neutral']).optional() }, false],
  ['annotate', 'Setzt eine kurze Textnotiz mit Zeiger an eine Kerze, z. B. "Ausbruch" oder "Fehlausbruch".', { bars_ago: num('Kerzen zurück'), price: num('Preis, Standard Schlusskurs').optional(), text: z.string(), kind: z.enum(['neutral', 'bull', 'bear', 'support', 'resistance']).optional(), above: z.boolean().describe('Notiz über (true) oder unter (false) dem Punkt').optional() }, false],
  ['optimize_strategy', 'Strategie-Labor: führt ein Mini-Script mit buy()/sell() für alle Kombinationen von ein oder zwei Parametern aus und zeigt eine Hitzekarte im Chart. Platzhalter im Script als $name schreiben, z. B. "schnell = ema(close, $f)". Liefert Raster, beste Kombination, Buy & Hold, wie viele Kombinationen Buy & Hold schlagen, und einen Robustheitstest (Wahl auf den ersten 70 % der Kerzen, Prüfung auf den letzten 30 %). Höchstens 60 Werte je Parameter und 900 Kombinationen.', { code: z.string().describe('Mini-Script mit $-Platzhaltern'), param1: z.object({ name: z.string(), from: z.number(), to: z.number(), step: z.number().optional() }), param2: z.object({ name: z.string(), from: z.number(), to: z.number(), step: z.number().optional() }).optional(), metric: z.enum(['return', 'profit_factor', 'max_drawdown', 'win_rate']).optional() }, false],
  ['replay', 'Steuert das Kerzen-Replay.', { action: z.enum(['start', 'pause', 'play', 'stop']) }, false],
];

function makeChartServer(conn) {
  const tools = TOOL_DEFS.map(([name, desc, schema, readOnly]) => tool(name, desc, schema, async (input) => {
    const r = await conn.callBrowser(name, input);
    if (!r.ok) return { content: [{ type: 'text', text: 'Fehler: ' + r.error }], isError: true };
    if (name === 'screenshot' && r.result?.image_png_base64) return { content: [{ type: 'image', data: r.result.image_png_base64, mimeType: 'image/png' }, { type: 'text', text: `Chart ${r.result.width}×${r.result.height} px` }] };
    return { content: [{ type: 'text', text: JSON.stringify(r.result) }] };
  }, { annotations: { readOnlyHint: readOnly } }));
  return createSdkMcpServer({ name: 'chart', version: '1.0.0', tools });
}

const SYSTEM = `Du bist Claude und sitzt direkt in "iC Charts", einer selbst gebauten Chart-Anwendung von Niko Sarge (YouTube-Kanal zu KI und Finanzen). Du sprichst Deutsch, kurz und konkret.

Du bedienst den Chart über die Werkzeuge des Servers "chart" (mcp__chart__*): Zustand lesen, Kerzen holen, Extrempunkte finden, Screenshot ansehen, Symbol und Zeiteinheit wechseln, Indikatoren schalten, Mini-Scripts und Backtests ausführen, Alarme, Linien, Fibonacci und Positionen zeichnen, Replay steuern.
Regeln:
- Rufe zuerst get_state auf, wenn du etwas über den Chart sagen oder tun sollst. Rate nie Kurse oder Werte, hole sie.
- Für Fibonacci oder Positionen erst find_extremes oder get_bars nutzen und die echten Preise übergeben.
- Handle nie mit echtem Geld: es gibt keine Börsenanbindung, und du gibst keine Anlageberatung. Du erklärst, rechnest und zeichnest.
- Nach einer Aktion ein bis drei Sätze, was du gemacht hast und was man sieht. Keine langen Listen.
- Scripts in der Mini-Script-Sprache schreiben, nicht in Pine Script oder JavaScript. Bei einem Fehler das Script korrigieren und erneut ausführen.
- Du darfst den Quellcode der App im Projektordner lesen (Read, Grep, Glob), zum Beispiel indicators.js, um Formeln zu erklären.

Chartanalyse (wenn du einzeichnen sollst, was du siehst): get_state, dann find_pivots (Wendepunkte) und screenshot. Lege Trendlinien mit draw_line durch zwei echte Wendepunkte (Tiefs für Aufwärtstrend, Hochs für Abwärtstrend), Unterstützungen und Widerstände mit draw_level an Preisen, die mehrfach getestet wurden, Zonen mit draw_zone, Muster mit draw_pattern durch die Wendepunkte, Hinweise mit annotate. Jede Figur bekommt eine kurze Beschriftung. Danach einmal screenshot zur Kontrolle und in wenigen Sätzen erklären, was man sieht. Höchstens etwa acht Figuren, lieber wenige treffende.

Strategie-Labor (wenn du optimieren sollst): Script mit $-Platzhaltern schreiben, optimize_strategy mit sinnvollen Bereichen aufrufen (lieber grob mit Schrittweite als 900 Zellen), dann ehrlich bewerten: Wie viele Kombinationen schlagen Buy & Hold, hält das Ergebnis im Robustheitstest, oder ist es Überanpassung? Die beste Kombination am Ende mit run_script ins Script setzen.`;

// ---------------- WebSocket: eine Unterhaltung je Verbindung ----------------
const wss = new WebSocketServer({ server, path: '/agent' });
wss.on('connection', (ws) => {
  const conn = { ws, sessionId: null, pending: new Map(), controller: null };
  const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  conn.callBrowser = (name, input) => new Promise((resolve) => {
    const id = crypto.randomUUID();
    const t = setTimeout(() => { conn.pending.delete(id); resolve({ ok: false, error: 'Browser antwortet nicht' }); }, 90000);
    conn.pending.set(id, (r) => { clearTimeout(t); resolve(r); });
    send({ type: 'tool_call', id, name, input });
  });
  send({ type: 'status', ready: true, text: MOCK ? 'Probelauf ohne Claude' : 'bereit', model: MODEL });

  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'tool_result') { const f = conn.pending.get(m.id); if (f) { conn.pending.delete(m.id); f(m); } return; }
    if (m.type === 'abort') { conn.controller?.abort(); return; }
    if (m.type === 'new_session') { conn.sessionId = null; return; }
    if (m.type !== 'user') return;
    if (conn.controller) { send({ type: 'error', message: 'Es läuft noch eine Antwort.' }); return; }
    if (MOCK) return mockTurn(conn, send, m);
    const t0 = Date.now();
    conn.controller = new AbortController();
    const ctx = m.context ? `\n\n[Chart-Kontext beim Absenden: ${JSON.stringify(m.context).slice(0, 1500)}]` : '';
    try {
      const q = query({
        prompt: m.text + ctx,
        options: {
          cwd: ROOT, model: MODEL, systemPrompt: SYSTEM,
          includePartialMessages: true,
          resume: conn.sessionId || undefined,
          mcpServers: { chart: makeChartServer(conn) },
          allowedTools: ['mcp__chart__*', 'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
          disallowedTools: ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'],
          permissionMode: 'default',
          abortController: conn.controller,
          env: { ...process.env, MCP_TOOL_TIMEOUT: '120000' },
        },
      });
      for await (const msg of q) {
        if (msg.type === 'system' && msg.subtype === 'init') conn.sessionId = msg.session_id;
        else if (msg.type === 'stream_event') {
          const ev = msg.event;
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') send({ type: 'text_delta', text: ev.delta.text });
          if (ev.type === 'content_block_stop') send({ type: 'assistant_done' });
        } else if (msg.type === 'assistant') {
          for (const b of msg.message.content) if (b.type === 'tool_use' && !b.name.startsWith('mcp__chart__')) send({ type: 'tool_use', name: b.name, input: b.input });
        } else if (msg.type === 'result') {
          conn.sessionId = msg.session_id || conn.sessionId;
          send({ type: 'result', model: MODEL, cost: msg.total_cost_usd, duration: msg.duration_ms ?? Date.now() - t0, turns: msg.num_turns, error: msg.subtype === 'success' ? undefined : `${msg.subtype}${msg.errors ? ': ' + msg.errors.join('; ') : ''}` });
        }
      }
    } catch (e) {
      send({ type: 'error', message: conn.controller?.signal.aborted ? 'Abgebrochen.' : (e.message || String(e)) });
    } finally { conn.controller = null; }
  });
  ws.on('close', () => { conn.controller?.abort(); });
});

// Probelauf ohne Claude: prüft nur den Weg Server → Browser-Werkzeug → Server
async function mockTurn(conn, send, m) {
  conn.controller = new AbortController();
  try {
    const st = await conn.callBrowser('get_state', {});
    send({ type: 'text_delta', text: `Probelauf: Der Chart zeigt ${st.result?.symbol} auf ${st.result?.timeframe}, letzter Kurs ${st.result?.last_price}. ` }); send({ type: 'assistant_done' });
    const ex = await conn.callBrowser('find_extremes', { lookback: 150 });
    if (ex.ok) {
      const f = await conn.callBrowser('draw_fibonacci', { from_bars_ago: ex.result.highest.bars_ago, from_price: ex.result.highest.price, to_bars_ago: ex.result.lowest.bars_ago, to_price: ex.result.lowest.price });
      send({ type: 'text_delta', text: `Ich habe ein Fibonacci vom Hoch ${ex.result.highest.price} zum Tief ${ex.result.lowest.price} gezeichnet (${f.ok ? 'ok' : f.error}).` }); send({ type: 'assistant_done' });
    }
    send({ type: 'result', model: 'mock', cost: 0, duration: 0, turns: 1 });
  } finally { conn.controller = null; }
}

server.listen(PORT, () => {
  console.log(`iC Charts + Claude: http://localhost:${PORT}/?claude=1   (Modell ${MODEL}${MOCK ? ', PROBELAUF ohne Claude' : ''})`);
});
