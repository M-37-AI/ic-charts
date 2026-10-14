# Testergebnis Indikatoren

Lauf: 2026-10-12T16:07:27.439Z mit Node v22.22.1, Skript tools/test_indikatoren.js

Referenzen: RSI(14)- und EMA(10)-Beispielreihen aus den StockCharts-ChartSchool-Tabellen (Ergebnisse dort auf 2 Nachkommastellen gerundet, Toleranz ±0,01 bzw. ±0,005); Bollinger, MACD, ATR und Stochastik gegen eine unabhängige naive Zweitrechnung; VWAP, crossover, SuperTrend und der Backtester (backtest.js) gegen Handrechnung; Mini-Script gegen indicators.js und eine Liste von Angriffs-/Fehleingaben.

Wichtige Beobachtung: Mit den auf 2 Stellen gerundeten Kursen aus dem Fließtext weicht der RSI um bis zu 0,07 Punkte ab (erster Wert 70,46 statt 70,53). Erst mit den Kursen in voller Genauigkeit (4 Nachkommastellen, wie in der Original-Tabelle) stimmen alle 19 RSI-Werte. Die Formel war richtig, die Eingabe war ungenau.

**Ergebnis: 82 bestanden, 0 fehlgeschlagen.**

| Prüfung | erwartet | berechnet | Status |
|---|---|---|---|
| RSI14 Tag 15 | 70.53 | 70.5328 | OK |
| RSI14 Tag 16 | 66.32 | 66.3186 | OK |
| RSI14 Tag 17 | 66.55 | 66.5498 | OK |
| RSI14 Tag 18 | 69.41 | 69.4063 | OK |
| RSI14 Tag 19 | 66.36 | 66.3552 | OK |
| RSI14 Tag 20 | 57.97 | 57.9749 | OK |
| RSI14 Tag 21 | 62.93 | 62.9296 | OK |
| RSI14 Tag 22 | 63.26 | 63.2571 | OK |
| RSI14 Tag 23 | 56.06 | 56.0593 | OK |
| RSI14 Tag 24 | 62.38 | 62.3771 | OK |
| RSI14 Tag 25 | 54.71 | 54.7076 | OK |
| RSI14 Tag 26 | 50.42 | 50.4228 | OK |
| RSI14 Tag 27 | 39.99 | 39.9898 | OK |
| RSI14 Tag 28 | 41.46 | 41.4605 | OK |
| RSI14 Tag 29 | 41.87 | 41.8689 | OK |
| RSI14 Tag 30 | 45.46 | 45.4632 | OK |
| RSI14 Tag 31 | 37.3 | 37.3040 | OK |
| RSI14 Tag 32 | 33.08 | 33.0795 | OK |
| RSI14 Tag 33 | 37.77 | 37.7730 | OK |
| SMA10 Tag 10 | 22.22 | 22.2248 | OK |
| EMA10 Tag 10 | 22.22 | 22.2248 | OK |
| EMA10 Tag 11 | 22.21 | 22.2119 | OK |
| EMA10 Tag 12 | 22.24 | 22.2448 | OK |
| EMA10 Tag 13 | 22.27 | 22.2697 | OK |
| EMA10 Tag 14 | 22.33 | 22.3317 | OK |
| EMA10 Tag 15 | 22.52 | 22.5179 | OK |
| EMA10 Tag 16 | 22.8 | 22.7968 | OK |
| EMA10 Tag 17 | 22.97 | 22.9707 | OK |
| EMA10 Tag 18 | 23.13 | 23.1273 | OK |
| EMA10 Tag 19 | 23.28 | 23.2772 | OK |
| EMA10 Tag 20 | 23.34 | 23.3420 | OK |
| EMA10 Tag 21 | 23.43 | 23.4294 | OK |
| EMA10 Tag 22 | 23.51 | 23.5099 | OK |
| EMA10 Tag 23 | 23.54 | 23.5361 | OK |
| EMA10 Tag 24 | 23.47 | 23.4726 | OK |
| EMA10 Tag 25 | 23.4 | 23.4044 | OK |
| EMA10 Tag 26 | 23.39 | 23.3902 | OK |
| EMA10 Tag 27 | 23.26 | 23.2611 | OK |
| EMA10 Tag 28 | 23.23 | 23.2314 | OK |
| EMA10 Tag 29 | 23.08 | 23.0807 | OK |
| EMA10 Tag 30 | 22.92 | 22.9156 | OK |
| Bollinger(20,2) max. Abweichung | 0 | 0.0000 | OK |
| MACD(12,26,9) max. Abweichung | 0 | 0.0000 | OK |
| MACD erster Signalwert bei Index 33 | 33 | 33.0000 | OK |
| VWAP Kerze 2 (Handrechnung 10.5) | 10.5 | 10.5000 | OK |
| VWAP Reset neuer Tag (=19) | 19 | 19.0000 | OK |
| crossover an Index 2 | 2 | 2.0000 | OK |
| Mini-Script ema(close,10) = indicators.ema | 22.91556023003093 | 22.9156 | OK |
| Mini-Script Punkt-vor-Strich (=2) | 2 | 2.0000 | OK |
| Mini-Script lehnt 10 Angriffs-/Fehleingaben ab | 10 | 10.0000 | OK |
| ATR(14) Wilder max. Abweichung | 0 | 0.0000 | OK |
| ATR(14) erster Wert bei Index 13 | 13 | 13.0000 | OK |
| Stochastik roh %K max. Abweichung | 0 | 0.0000 | OK |
| Stochastik %K liegt in 0–100 | 1 | 1.0000 | OK |
| SuperTrend Aufwärtstrend: Linie unter dem Kurs | 1 | 1.0000 | OK |
| SuperTrend Trendwechsel nach dem Einbruch | -1 | -1.0000 | OK |
| SuperTrend Abwärtstrend: Linie über dem Kurs | 1 | 1.0000 | OK |
| Backtest: 2 Trades | 2 | 2.0000 | OK |
| Backtest: Rendite Trade 1 (+8,9 % nach Gebühr) | 0.0887283636363636 | 0.0887 | OK |
| Backtest: Rendite Trade 2 (+10,9 % nach Gebühr) | 0.10889000000000015 | 0.1089 | OK |
| Backtest: Endkapital = Produkt der Trades | 0.20727999515272733 | 0.2073 | OK |
| Backtest: Trefferquote 100 % | 1 | 1.0000 | OK |
| Backtest: kein Blick in die Zukunft (Kauf erst auf Kerze 2) | 2 | 2.0000 | OK |
| Backtest ohne Signale: Kapital bleibt 100 | 100 | 100.0000 | OK |
| Mini-Script buy()/sell() erkannt | 2 | 2.0000 | OK |
| alignSeries: vor dem ersten Punkt null | 1 | 1.0000 | OK |
| alignSeries: exakte Zeit trifft den Punkt | 50 | 50.0000 | OK |
| alignSeries: zwischen zwei Punkten gilt der ältere | 50 | 50.0000 | OK |
| alignSeries: 250 -> Wert von 200 | 52 | 52.0000 | OK |
| alignSeries: letzter Punkt | 55 | 55.0000 | OK |
| alignSeries: nach dem Ende gilt der letzte Wert | 55 | 55.0000 | OK |
| alignSeries: Länge = Kerzenzahl | 6 | 6.0000 | OK |
| alignSeries: ohne Punkte nur null | 1 | 1.0000 | OK |
| alignSeries: Punkt innerhalb der laufenden Kerze zählt (Live-Wert) | 2 | 2.0000 | OK |
| alignSeries: Punkt genau am Kerzenschluss gehört zur nächsten Kerze | 1 | 1.0000 | OK |
| mergeSeries: Tageswerte vor der Stundenreihe bleiben | 101 | 101.0000 | OK |
| mergeSeries: ab der ersten Stunde nur Stundenwerte | 52.1 | 52.1000 | OK |
| mergeSeries: Tageswert 259200 (innerhalb/nach Stundenbereich, aber älterer Rang) entfällt | 0 | 0.0000 | OK |
| mergeSeries: Live-Punkt am Ende | 52.9 | 52.9000 | OK |
| mergeSeries: Gesamtlänge 6 | 6 | 6.0000 | OK |
| mergeSeries: Live-Punkt älter als letzte Stunde wird verworfen | 3 | 3.0000 | OK |
| mergeSeries: leere Teilreihen sind erlaubt | 4 | 4.0000 | OK |
