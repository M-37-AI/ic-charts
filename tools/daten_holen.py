#!/usr/bin/env python3
"""Holt öffentliche Kursdaten ohne Login/Schlüssel und legt sie als data/snapshot.js ab.
Krypto: Binance öffentliche REST-API (Offline-Fallback). Aktien: Yahoo-Finance-Chart-Endpunkt (öffentlich).
Bitcoin-Dominanz: Website-Endpunkt von CoinMarketCap (ohne Schlüssel; Tageswerte 3 Jahre, Stundenwerte 30 Tage).
Ausgabe als JS-Datei (window.SNAPSHOT = ...), damit die Seite auch per Doppelklick (file://) läuft.
Aufruf: python3 tools/daten_holen.py            alles neu holen
        python3 tools/daten_holen.py --nur-dominanz   nur die Dominanz im vorhandenen Schnappschuss erneuern"""
import json, urllib.request, time, os, sys, calendar
UA = {"User-Agent": "Mozilla/5.0"}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return json.loads(r.read())
out = os.path.join(os.path.dirname(__file__), "..", "data", "snapshot.js")

def hole_dominanz():
    """Bitcoin-Dominanz in % als [[zeit, wert], ...]; Zeiten auf Tages- bzw. Stundenbeginn gerundet (UTC)."""
    basis = "https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical"
    jetzt = int(time.time()); dom = {}
    for name, iv, tage, schritt in [("tage", "1d", 3 * 365, 86400), ("stunden", "1h", 30, 3600)]:
        j = get(f"{basis}?timeStart={jetzt - tage * 86400}&timeEnd={jetzt}&interval={iv}&convertId=2781")
        punkte = {}
        for q in j["data"]["quotes"]:
            t = calendar.timegm(time.strptime(q["timestamp"][:19], "%Y-%m-%dT%H:%M:%S"))
            punkte[t // schritt * schritt] = round(float(q["btcDominance"]), 2)
        dom[name] = [[t, v] for t, v in sorted(punkte.items())]
        time.sleep(0.3)
    dom["stand"] = time.strftime("%Y-%m-%d %H:%M")
    return dom

if "--nur-dominanz" in sys.argv:
    with open(out) as f:
        alt = f.read()
    snap = json.loads(alt[alt.index("{"):alt.rindex("}") + 1])
    snap["dominanz"] = hole_dominanz()
    print("Dominanz", len(snap["dominanz"]["tage"]), "Tage,", len(snap["dominanz"]["stunden"]), "Stunden")
    with open(out, "w") as f:
        f.write("// Automatisch erzeugt von tools/daten_holen.py – öffentliche Daten, nur zur Demonstration\n")
        f.write("window.SNAPSHOT = " + json.dumps(snap, separators=(",", ":")) + ";\n")
    print("geschrieben", os.path.getsize(out), "Bytes"); sys.exit(0)

snap = {"erstellt": time.strftime("%Y-%m-%d %H:%M"), "krypto": {}, "aktien": {}}
for sym in ["BTCUSDT", "ETHUSDT", "SOLUSDT"]:
    snap["krypto"][sym] = {}
    for iv in ["1m", "5m", "15m", "1h", "4h", "1d"]:
        k = get(f"https://api.binance.com/api/v3/klines?symbol={sym}&interval={iv}&limit=500")
        snap["krypto"][sym][iv] = [[int(x[0]//1000), float(x[1]), float(x[2]), float(x[3]), float(x[4]), round(float(x[5]), 4)] for x in k]
        time.sleep(0.2)
    print(sym, "ok")
AKTIEN = {"AAPL": "AAPL", "NVDA": "NVDA", "MSFT": "MSFT", "SAP": "SAP.DE"}
for name, ysym in AKTIEN.items():
    snap["aktien"][name] = {}
    for iv, rng in [("1d", "3y"), ("1h", "180d"), ("15m", "60d"), ("5m", "30d")]:
        j = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}?range={rng}&interval={iv}")
        r = j["chart"]["result"][0]; q = r["indicators"]["quote"][0]
        rows = []
        for i, t in enumerate(r["timestamp"]):
            o, h, l, c, v = q["open"][i], q["high"][i], q["low"][i], q["close"][i], q["volume"][i]
            if None in (o, h, l, c): continue
            rows.append([t, round(o, 4), round(h, 4), round(l, 4), round(c, 4), v or 0])
        snap["aktien"][name][iv] = rows
        time.sleep(0.3)
    snap["aktien"][name]["waehrung"] = r["meta"].get("currency", "")
    print(name, "ok")
snap["dominanz"] = hole_dominanz()
print("Dominanz", len(snap["dominanz"]["tage"]), "Tage,", len(snap["dominanz"]["stunden"]), "Stunden")
with open(out, "w") as f:
    f.write("// Automatisch erzeugt von tools/daten_holen.py – öffentliche Daten, nur zur Demonstration\n")
    f.write("window.SNAPSHOT = " + json.dumps(snap, separators=(",", ":")) + ";\n")
print("geschrieben", os.path.getsize(out), "Bytes")
