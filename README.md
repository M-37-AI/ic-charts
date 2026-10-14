# iC Charts – eigener Nachbau einer Trading-Chart-Plattform

Für das Video zum REA-Test (Kanal Niko Sarge). REA hat gezeigt: TradingView Desktop ist nur eine Electron-Hülle, die Logik liegt auf dem Server.
Hier baut Claude so etwas selbst, mit **eigenem Code** und einer Open-Source-Chartbibliothek. Kein Code aus TradingView Desktop, kein Login, keine API-Schlüssel.

## Starten
- **Doppelklick auf `index.html`** – läuft direkt im Browser, alle Skripte liegen lokal. Krypto (BTC, ETH, SOL und jedes andere Binance-Paar) kommt sofort live von Binance.
- **Aktien, Bitcoin-Dominanz und Offline-Modus** brauchen einmal `python3 tools/daten_holen.py` (Python 3, keine Zusatzpakete). Das Skript legt `data/snapshot.js` an. Die Kursdaten sind nicht im Repository, weil sie den jeweiligen Anbietern gehören.
- Oder als kleiner Server: `cd ic-charts && python3 -m http.server 8000` → http://localhost:8000
- URL-Parameter (praktisch fürs Video): `?sym=ETHUSDT&tf=15m&ind=ema,bb,rsi,macd&ex=1&demo=1&test=1`
  - `sym` Symbol, `tf` 1m/5m/15m/1h/4h/1d, `ind` Indikatoren (sma, ema, bb, vwap, st, rsi, macd, btcd = Bitcoin-Dominanz)
  - `ex=1…7` lädt ein Mini-Script-Beispiel (6 = Strategie EMA, 7 = Strategie SuperTrend), `demo=1` setzt Trendlinie, Linie und Alarm (`alarmPct=0.2` = Abstand in %)
  - `replay=1` startet das Kerzen-Replay (`pause=1` angehalten), `test=1` Testmodus: gespeicherte Daten + simulierte Ticks, ohne Internet
- Script-Text und Indikator-Auswahl werden im Browser gemerkt (localStorage), URL-Parameter haben Vorrang.

## Bedienung
- Symbolfeld oben (BTCUSDT, ETHUSDT, SOLUSDT live; AAPL, NVDA, MSFT, SAP aus dem Schnappschuss; jedes andere Binance-Paar wie DOGEUSDT geht auch live).
- Werkzeuge links: Fadenkreuz, horizontale Linie (Alt+H), Preisalarm (Alt+A), Trendlinie (Alt+T, zwei Klicks mit Vorschau), **Fibonacci-Retracement** (Alt+F, zwei Klicks: Ebenen 0 / 0,236 / 0,382 / 0,5 / 0,618 / 0,786 / 1 plus 1,272 und 1,618 gestrichelt, mit Preisen), **Position** (Alt+P, drei Klicks: Einstieg, Ziel, Stop; Ziel über dem Einstieg = Long, darunter = Short; zeigt Gewinn- und Verlustzone, Prozentabstände und das Chance-Risiko-Verhältnis CRV), Löschen, Ansicht zurücksetzen, **Vollbild** (Alt+V: nur der Chart mit Werkzeugleiste, alles andere ausgeblendet; Esc oder Alt+V beendet es). Esc bricht ab, Rücktaste entfernt die letzte Zeichnung. Fibonacci und Positionen werden in `drawings.js` als eigene Zeichenebene (Plugin der Chartbibliothek) gemalt und wandern beim Scrollen/Zoomen mit.
- Alarm: gelbe gestrichelte Linie; kreuzt der Live-Kurs sie, gibt es Ton, Aufblinken des Charts, Hinweis oben rechts und einen Eintrag in der Alarmliste.
- Mini-Script rechts: Formel tippen, **Strg/Cmd+Enter**. Beispiele:
  - `plot(ema(close, 21))`
  - `alert(crossover(ema(close,9), ema(close,21)), "Kreuz hoch")`
  - `panel(rsi(close, 14) - 50)`
  - `buy(crossover(close, supertrend(10, 3)))` + `sell(crossunder(close, supertrend(10, 3)))` → **Backtest**
- Backtest (sobald `buy`/`sell` im Script stehen): nur long, Signal auf Kerze t wird zur Eröffnung von t+1 ausgeführt (kein Blick in die Zukunft), 0,1 % Gebühr je Seite. Kapitalkurve und Buy & Hold erscheinen als Panel, Käufe/Verkäufe als Pfeile mit Trade-Ergebnis, Kennzahlen (Rendite, max. Rückgang, Trefferquote, Profitfaktor, Ø Trade, investierte Zeit) unter dem Editor. Läuft live mit: ein neues Signal auf der letzten Kerze meldet sich mit Ton.
- **Replay** (Kopfzeile): spielt die geladenen Kerzen ab 150 Kerzen vor dem Ende Kerze für Kerze ab, jede Kerze wächst in drei Schritten. Leertaste = Pause, → = eine Kerze weiter, Schieberegler = Position, 1×–8×. Alarme, Script und Backtest reagieren dabei wie live.
- **Orderbuch** (Seitenleiste, nur Krypto live): 10 Stufen je Seite vom Binance-Depth-Stream, Balken = kumulierte Menge, Spread in der Mitte.
- **Bitcoin-Dominanz (BTC.D)**: Knopf „BTC.D“ in der Indikatorleiste (oder `ind=btcd`) öffnet ein eigenes Panel unter dem Kurs, an die Zeitachse gekoppelt – gedacht für die Altcoin-Analyse. Werte in Prozent: Tageswerte 3 Jahre, Stundenwerte 30 Tage (auf 1D der letzte Wert des Tages, intraday der Stundenwert als Stufe). Historie kommt über den Agent-Server (`/api/dominanz`, 10 Minuten zwischengespeichert) oder aus dem Schnappschuss (`python3 tools/daten_holen.py --nur-dominanz` erneuert nur diesen Teil). Ist die Historie älter als zwei Stunden, hängt die Seite den aktuellen Wert von CoinGecko als letzten Punkt an und schreibt das in die Legende – CoinGecko zählt ein etwas anderes Coin-Universum, der Wert liegt meist einige Zehntel unter CoinMarketCap.

## Claude im Chart (Agent)
Ein Chat-Panel (Knopf „✦ Claude“ in der Kopfzeile, Alt+C, oder `?claude=1`) verbindet sich mit `agent/server.mjs`. Dort läuft das **Claude Agent SDK** (der Kern von Claude Code). Claude bedient den Chart über eigene Werkzeuge, die im Browser ausgeführt werden: Zustand und Kerzen lesen, Extrempunkte finden, Screenshot ansehen, Symbol/Zeiteinheit/Indikatoren (auch BTC.D) schalten, Mini-Scripts samt Backtest ausführen, Alarme, Linien, Fibonacci und Positionen zeichnen, Replay steuern. Dateien im Projekt darf Claude lesen (Read/Grep/Glob), nicht ändern; Bash ist gesperrt. Es gibt keine Börsenanbindung.

**Analyse-Zeichnungen:** Claude holt mit `find_pivots` die Wendepunkte (Swing-Hochs/-Tiefs) und zeichnet beschriftet mit `draw_line` (Trendlinie, optional als Strahl), `draw_level` (Unterstützung/Widerstand bis zum rechten Rand mit Preis), `draw_zone` (Preiszone), `draw_pattern` (Linienzug durch mehrere Punkte, z. B. Dreieck oder Kopf-Schulter, Beschriftung in der Mitte) und `annotate` (Notiz mit Zeiger). Farben: Mint = Unterstützung/bullisch, Koralle = Widerstand/bärisch, Bernstein = Trend, Lila = Muster. `undo_drawing` entfernt die letzte Figur.

**Strategie-Labor (`lab.js`):** `optimize_strategy` führt ein Mini-Script mit `$`-Platzhaltern für alle Kombinationen von ein oder zwei Parametern aus (höchstens 60 Werte je Parameter, 900 Kombinationen) und zeigt eine Hitzekarte über dem Chart: Zellfarbe relativ zu Buy & Hold (Mint besser, Koralle schlechter), beste Zelle markiert, Klick setzt die Parameter ins Script. Dazu Kennzahlen, wie viele Kombinationen Buy & Hold schlagen, der Median, und ein Robustheitstest: Parameter nur auf den ersten 70 % der Kerzen gewählt, dann auf den letzten 30 % geprüft. Läuft komplett im Browser (42 Kombinationen auf 1000 Kerzen in rund 30 ms).

**Starten (auf dem Rechner mit der Claude-Anmeldung):**
```
cd agent && npm install && npm start        # Node 18+, Port 8787
```
Dann im Browser `http://<rechner>:8787/?claude=1` öffnen (der Server liefert auch die Chart-App). Von einem anderen Rechner im Netz: `http://<ip-des-rechners>:8787/?claude=1`.

**Anmeldung:** Das SDK nutzt in dieser Reihenfolge `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` (aus `claude setup-token`) oder die vorhandene Claude-Code-Anmeldung des Rechners (`claude` → `/login`). Variablen können in `agent/.env` stehen (`KEY=WERT`, Datei ist in `.gitignore` und wird vom Server nicht ausgeliefert). Laut Anthropic ist die Abo-Anmeldung für eigene Produkte, die an Dritte gehen, nicht erlaubt; für den eigenen lokalen Gebrauch steht dort nichts dagegen. Modell per `CLAUDE_MODEL` (Standard `claude-opus-5-5`).

**Probelauf ohne Claude:** `npm run mock` startet den Server im Probelauf: eine feste Antwort, die get_state, find_extremes und draw_fibonacci im Browser aufruft. So lässt sich die Verbindung prüfen (`node tools/agent-test.js`).

**Protokoll (WebSocket `/agent`):** Browser → Server `user` (Text + Chart-Kontext), `tool_result`, `abort`, `new_session`; Server → Browser `status`, `text_delta`, `assistant_done`, `tool_call` (Chart-Werkzeug, im Browser ausführen), `tool_use` (sonstige Werkzeuge, nur Anzeige), `result` (Kosten, Dauer, Züge), `error`. Jede Verbindung ist eine Unterhaltung; Folgefragen laufen über `resume` mit der Session-ID des SDK.

## Aufbau
| Datei | Inhalt |
|---|---|
| `index.html`, `style.css` | Oberfläche: eigenes Design (warmes Anthrazit, Bernstein-Akzent, Mint/Koralle für Kerzen, Kursleiste oben, schwebende Werkzeugleiste; Schriften Fraunces/Manrope/JetBrains Mono von Google Fonts, offline Systemschriften) |
| `app.js` | Daten laden, Live-WebSocket, Orderbuch, Replay, Panes, Fadenkreuz-Legende, Zeichenwerkzeuge, Alarme, Backtest-Anzeige, Testmodus |
| `indicators.js` | SMA, EMA, RMA (Wilder), Standardabweichung, Bollinger, RSI (Wilder), MACD, VWAP, ATR, Stochastik, SuperTrend, crossover – mit Formeln im Kommentar; `alignSeries`/`mergeSeries` legen Zeitreihen wie die Dominanz auf Kerzen |
| `lab.js` | Strategie-Labor: Parameterraster, Backtests, Hitzekarte, Robustheitstest |
| `agent-panel.js` | Chat-Panel und die Chart-Werkzeuge, die Claude im Browser ausführt |
| `agent/server.mjs`, `agent/package.json` | Lokaler Server: statische Dateien, `/api/dominanz` (Proxy für die Bitcoin-Dominanz), WebSocket, Claude Agent SDK mit In-Process-MCP-Server „chart“ |
| `drawings.js` | Zeichenebene (Series Primitive): Fibonacci-Retracement und Long/Short-Position mit CRV |
| `backtest.js` | Backtester für `buy`/`sell`: Kapitalkurve, Trades, Kennzahlen (nur long, nächste Eröffnung, Gebühr) |
| `script-engine.js` | Mini-Script: eigener Tokenizer, Parser (rekursiver Abstieg) und Interpreter. **Kein eval, kein new Function**, nur freigegebene Namen, Längen-/Tiefen-/Periodenlimits |
| `data/snapshot.js` | Kursdaten-Schnappschuss (Offline-Fallback und Aktien) und Bitcoin-Dominanz-Historie; wird von `tools/daten_holen.py` erzeugt, nicht im Repository |
| `lib/` | Lightweight Charts 4.2.0 (unverändert) + Lizenztext |
| `tools/daten_holen.py` | holt den Schnappschuss neu (`python3 tools/daten_holen.py`, `--nur-dominanz` nur die Dominanz) |
| `tools/test_indikatoren.js` | Indikator- und Parser-Tests (`node tools/test_indikatoren.js`) → `test-ergebnis.md` |
| `tools/screenshots.js` | Playwright-Screenshots → `screenshots/` |
| `tools/agent-test.js` | Prüft Panel und Werkzeug-Roundtrip gegen den Probelauf-Server |
| `tools/tools-test.js` | Prüft Analyse-Zeichnungen und Strategie-Labor direkt im Browser |

Mehrere Panes (Kurs, RSI, MACD, Script) sind einzelne Charts, deren Zeitachsen und Fadenkreuze gekoppelt sind. Live-Ticks aktualisieren nur die letzte Kerze; Indikatoren werden je Tick neu gerechnet (1000 Kerzen dauern unter 2 ms).

## Datenquellen
- **Krypto live:** Binance öffentliche REST-API (`/api/v3/klines`, `/api/v3/ticker/24hr`) und WebSocket (`@kline_<tf>`, `@miniTicker`, `@depth10` fürs Orderbuch). Ohne Konto, ohne Schlüssel.
- **Aktien:** Schnappschuss vom öffentlichen Yahoo-Finance-Chart-Endpunkt (Tageskerzen 3 Jahre, 1h 180 Tage, 15m 60 Tage, 5m 30 Tage; 4h wird aus 1h gebaut; SAP = SAP.DE/XETRA). Stooq war geplant, liefert aber inzwischen eine JavaScript-Bot-Prüfung statt CSV; die wurde bewusst nicht umgangen.
- **Bitcoin-Dominanz:** Historie vom JSON-Endpunkt, den die CoinMarketCap-Website selbst nutzt (`api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical`; ohne Schlüssel, keine Bot-Prüfung, aber ohne CORS – darum über den Agent-Server oder per Script in den Schnappschuss). Aktueller Wert von CoinGecko `/api/v3/global` (ohne Schlüssel, CORS frei). Geprüft und verworfen: CoinGecko-Historie der Gesamtmarktkapitalisierung (nur Pro-Tarif), CoinPaprika-Historie (kostenpflichtig), CryptoCompare/CoinCap (Schlüssel nötig), Näherung aus Top-30-Marktkapitalisierungen (CoinGecko drosselt nach wenigen Aufrufen, Wert ~2 Punkte zu hoch).
- **Fallback:** Ist Binance nicht erreichbar, nimmt die Seite den Schnappschuss und simuliert Ticks (Statusanzeige gelb). Im Testmodus zieht die Simulation den Kurs leicht zum nächsten offenen Alarm, damit die Alarm-Demo sicher auslöst – **das ist Simulation, keine Marktbewegung**.

Nur zur Demonstration, keine Anlageberatung, keine Gewähr für Daten.

## Lizenzen
- Eigener Code (HTML/CSS/JS, Python/Node-Skripte): MIT-Lizenz, siehe `LICENSE`. Erstellt für das Video von Niko Sarge.
- **Lightweight Charts™ 4.2.0**, Copyright © TradingView, Inc., Apache License 2.0 – `lib/LICENSE-lightweight-charts.txt`. Die geforderte Namensnennung steht in der Fußzeile (Link auf tradingview.com/lightweight-charts) und im Dialog „Lizenzen“; das eingeblendete Logo der Bibliothek ist abgeschaltet.
- Marktdaten: Rechte bei den jeweiligen Anbietern (Binance, Yahoo, CoinMarketCap, CoinGecko). Sie werden nicht mitgeliefert, sondern beim Start bzw. per Skript direkt beim Anbieter abgerufen. Beachte deren Nutzungsbedingungen.
