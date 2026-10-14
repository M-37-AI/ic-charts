/*
 * script-engine.js – "Mini-Script": eine winzige, sichere Formelsprache für den Chart.
 *
 * Beispiele:
 *   plot(ema(close, 21), "orange")
 *   schnell = ema(close, 9)
 *   langsam = ema(close, 21)
 *   alert(crossover(schnell, langsam), "Golden Cross")
 *   panel(rsi(close, 14) - 50)
 *   buy(crossover(close, supertrend(10, 3)))   → Backtest in backtest.js
 *   sell(crossunder(close, supertrend(10, 3)))
 *
 * Sicherheit: Es gibt KEIN eval und KEIN new Function. Der Text wird in Tokens
 * zerlegt, von einem eigenen Parser (rekursiver Abstieg) in einen Syntaxbaum
 * übersetzt und dieser Baum von einem Interpreter ausgewertet, der nur die
 * unten aufgeführten Namen kennt. Alles andere ist ein Fehler.
 */
(function (root) {
  'use strict';
  const I = root.Indicators || (typeof require !== 'undefined' ? require('./indicators.js') : null);
  const LIMITS = { maxChars: 4000, maxTokens: 1500, maxDepth: 40, maxPeriod: 1000, maxOutputs: 12 };

  // ---------- 1. Tokenizer ----------
  function tokenize(text) {
    if (text.length > LIMITS.maxChars) throw new Error(`Skript zu lang (max. ${LIMITS.maxChars} Zeichen)`);
    const toks = []; let i = 0, line = 1;
    const push = (type, value) => { toks.push({ type, value, line }); if (toks.length > LIMITS.maxTokens) throw new Error('Zu viele Tokens'); };
    while (i < text.length) {
      const c = text[i];
      if (c === '\n') { push('nl'); line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(text.slice(i));
        if (!m) throw new Error(`Zeile ${line}: ungültige Zahl`);
        push('num', parseFloat(m[0])); i += m[0].length; continue;
      }
      if (/[A-Za-z_äöüÄÖÜß]/.test(c)) {
        const m = /^[A-Za-z_äöüÄÖÜß][A-Za-z0-9_äöüÄÖÜß]*/.exec(text.slice(i));
        push('id', m[0]); i += m[0].length; continue;
      }
      if (c === '"' || c === "'") {
        const end = text.indexOf(c, i + 1);
        if (end < 0) throw new Error(`Zeile ${line}: Anführungszeichen nicht geschlossen`);
        push('str', text.slice(i + 1, end)); i = end + 1; continue;
      }
      const two = text.slice(i, i + 2);
      if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) { push('op', two); i += 2; continue; }
      if ('+-*/<>()=,!'.includes(c)) { push('op', c); i++; continue; }
      throw new Error(`Zeile ${line}: unbekanntes Zeichen „${c}“`);
    }
    push('eof');
    return toks;
  }

  // ---------- 2. Parser (rekursiver Abstieg) ----------
  // Grammatik:
  //   programm  := { anweisung (nl | eof) }
  //   anweisung := NAME '=' ausdruck | ausdruck
  //   ausdruck  := oder ; oder := und { ('or'|'||') und } ; und := vergl { ('and'|'&&') vergl }
  //   vergl     := summe [ ('>'|'<'|'>='|'<='|'=='|'!=') summe ]
  //   summe     := produkt { ('+'|'-') produkt } ; produkt := unaer { ('*'|'/') unaer }
  //   unaer     := ('-'|'not'|'!') unaer | atom
  //   atom      := ZAHL | TEXT | NAME [ '(' [ausdruck {',' ausdruck}] ')' ] | '(' ausdruck ')'
  function parse(text) {
    const t = tokenize(text); let p = 0, depth = 0;
    const peek = () => t[p], next = () => t[p++];
    const isOp = (v) => peek().type === 'op' && peek().value === v;
    const isKw = (v) => peek().type === 'id' && peek().value === v;
    const expect = (v) => { if (!isOp(v)) throw new Error(`Zeile ${peek().line}: „${v}“ erwartet`); next(); };
    const enter = () => { if (++depth > LIMITS.maxDepth) throw new Error('Ausdruck zu tief verschachtelt'); };
    function expr() { enter(); const r = orE(); depth--; return r; }
    function orE() { let l = andE(); while (isKw('or') || isOp('||')) { next(); l = { k: 'bin', op: 'or', l, r: andE() }; } return l; }
    function andE() { let l = cmp(); while (isKw('and') || isOp('&&')) { next(); l = { k: 'bin', op: 'and', l, r: cmp() }; } return l; }
    function cmp() { const l = sum(); for (const o of ['>', '<', '>=', '<=', '==', '!=']) if (isOp(o)) { next(); return { k: 'bin', op: o, l, r: sum() }; } return l; }
    function sum() { let l = prod(); while (isOp('+') || isOp('-')) { const op = next().value; l = { k: 'bin', op, l, r: prod() }; } return l; }
    function prod() { let l = unary(); while (isOp('*') || isOp('/')) { const op = next().value; l = { k: 'bin', op, l, r: unary() }; } return l; }
    function unary() {
      if (isOp('-')) { next(); enter(); const r = { k: 'neg', e: unary() }; depth--; return r; }
      if (isKw('not') || isOp('!')) { next(); enter(); const r = { k: 'not', e: unary() }; depth--; return r; }
      return atom();
    }
    function atom() {
      const tk = next();
      if (tk.type === 'num') return { k: 'num', v: tk.value };
      if (tk.type === 'str') return { k: 'str', v: tk.value };
      if (tk.type === 'op' && tk.value === '(') { const e = expr(); expect(')'); return e; }
      if (tk.type === 'id') {
        if (isOp('(')) {
          next(); const args = [];
          if (!isOp(')')) { do { if (isOp(',')) next(); args.push(expr()); } while (isOp(',')); }
          expect(')');
          return { k: 'call', name: tk.value.toLowerCase(), args, line: tk.line };
        }
        return { k: 'var', name: tk.value, line: tk.line };
      }
      throw new Error(`Zeile ${tk.line}: unerwartetes ${tk.type === 'eof' ? 'Ende' : '„' + (tk.value ?? 'Zeilenende') + '“'}`);
    }
    const prog = [];
    while (peek().type !== 'eof') {
      if (peek().type === 'nl') { next(); continue; }
      let st;
      if (peek().type === 'id' && t[p + 1].type === 'op' && t[p + 1].value === '=') {
        const name = next().value; next(); st = { k: 'assign', name, e: expr() };
      } else st = { k: 'expr', e: expr() };
      if (peek().type !== 'nl' && peek().type !== 'eof') throw new Error(`Zeile ${peek().line}: Zeilenende erwartet`);
      prog.push(st);
    }
    return prog;
  }

  // ---------- 3. Interpreter ----------
  const COLORS = { orange: '#ff9f43', blau: '#4d8dff', blue: '#4d8dff', gruen: '#3ddc97', grün: '#3ddc97', green: '#3ddc97', rot: '#ff6b7a', red: '#ff6b7a', gelb: '#ffd166', yellow: '#ffd166', lila: '#b388ff', purple: '#b388ff', weiss: '#e6e9ef', white: '#e6e9ef', cyan: '#22d3ee', pink: '#ff6bcb' };
  const PALETTE = ['#ff9f43', '#22d3ee', '#b388ff', '#ffd166', '#ff6bcb', '#3ddc97'];

  function run(text, bars) {
    const prog = parse(text);
    const N = bars.length;
    const base = {
      open: bars.map((b) => b.open), high: bars.map((b) => b.high), low: bars.map((b) => b.low),
      close: bars.map((b) => b.close), volume: bars.map((b) => b.volume),
    };
    base.hl2 = base.high.map((h, i) => (h + base.low[i]) / 2);
    base.hlc3 = base.high.map((h, i) => (h + base.low[i] + base.close[i]) / 3);
    const vars = Object.create(null);
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k); // nur eigene Namen, nie Prototyp-Eigenschaften
    const outputs = [];
    const isSeries = Array.isArray;
    const num = (x) => (isSeries(x) ? x : new Array(N).fill(x));
    const intArg = (x, name) => {
      if (isSeries(x) || typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`${name}: Periode muss eine feste Zahl sein`);
      const n = Math.round(x); if (n < 1 || n > LIMITS.maxPeriod) throw new Error(`${name}: Periode 1–${LIMITS.maxPeriod}`); return n;
    };
    const elem = (a, b, f) => {
      if (!isSeries(a) && !isSeries(b)) return f(a, b);
      const A = num(a), B = num(b);
      return A.map((v, i) => (I.isNum(v) && I.isNum(B[i]) ? f(v, B[i]) : null));
    };
    const seriesArg = (x, fname) => { if (typeof x === 'string') throw new Error(`${fname}: Reihe erwartet, Text erhalten`); return num(x); };
    const argc = (fname, args, min, max) => { if (args.length < min || args.length > max) throw new Error(`${fname}() erwartet ${min === max ? min : min + '–' + max} Argumente`); };

    const FUNCS = {
      sma: (a) => (argc('sma', a, 2, 2), I.sma(seriesArg(a[0], 'sma'), intArg(a[1], 'sma'))),
      ema: (a) => (argc('ema', a, 2, 2), I.ema(seriesArg(a[0], 'ema'), intArg(a[1], 'ema'))),
      rma: (a) => (argc('rma', a, 2, 2), I.rma(seriesArg(a[0], 'rma'), intArg(a[1], 'rma'))),
      rsi: (a) => (argc('rsi', a, 1, 2), I.rsi(seriesArg(a[0], 'rsi'), a[1] === undefined ? 14 : intArg(a[1], 'rsi'))),
      stdev: (a) => (argc('stdev', a, 2, 2), I.stdev(seriesArg(a[0], 'stdev'), intArg(a[1], 'stdev'))),
      highest: (a) => (argc('highest', a, 2, 2), I.highest(seriesArg(a[0], 'highest'), intArg(a[1], 'highest'))),
      lowest: (a) => (argc('lowest', a, 2, 2), I.lowest(seriesArg(a[0], 'lowest'), intArg(a[1], 'lowest'))),
      bbupper: (a) => (argc('bbupper', a, 1, 3), I.bollinger(seriesArg(a[0], 'bbupper'), a[1] ? intArg(a[1], 'bbupper') : 20, a[2] ?? 2).upper),
      bblower: (a) => (argc('bblower', a, 1, 3), I.bollinger(seriesArg(a[0], 'bblower'), a[1] ? intArg(a[1], 'bblower') : 20, a[2] ?? 2).lower),
      macd: (a) => (argc('macd', a, 1, 1), I.macd(seriesArg(a[0], 'macd')).macd),
      macdsignal: (a) => (argc('macdsignal', a, 1, 1), I.macd(seriesArg(a[0], 'macdsignal')).signal),
      macdhist: (a) => (argc('macdhist', a, 1, 1), I.macd(seriesArg(a[0], 'macdhist')).hist),
      vwap: (a) => (argc('vwap', a, 0, 0), I.vwap(bars)),
      atr: (a) => (argc('atr', a, 0, 1), I.atr(bars, a[0] === undefined ? 14 : intArg(a[0], 'atr'))),
      stoch: (a) => (argc('stoch', a, 0, 2), I.stoch(bars, a[0] === undefined ? 14 : intArg(a[0], 'stoch'), a[1] === undefined ? 3 : intArg(a[1], 'stoch')).k),
      stochd: (a) => (argc('stochd', a, 0, 3), I.stoch(bars, a[0] === undefined ? 14 : intArg(a[0], 'stochd'), a[1] === undefined ? 3 : intArg(a[1], 'stochd'), a[2] === undefined ? 3 : intArg(a[2], 'stochd')).d),
      supertrend: (a) => { argc('supertrend', a, 0, 2); const m = a[1] === undefined ? 3 : a[1]; if (typeof m !== 'number' || !(m > 0 && m < 100)) throw new Error('supertrend: Faktor 0–100'); return I.supertrend(bars, a[0] === undefined ? 10 : intArg(a[0], 'supertrend'), m).line; },
      crossover: (a) => (argc('crossover', a, 2, 2), I.crossover(seriesArg(a[0], 'crossover'), seriesArg(a[1], 'crossover'))),
      crossunder: (a) => (argc('crossunder', a, 2, 2), I.crossunder(seriesArg(a[0], 'crossunder'), seriesArg(a[1], 'crossunder'))),
      change: (a) => { argc('change', a, 1, 2); const s = seriesArg(a[0], 'change'), n = a[1] ? intArg(a[1], 'change') : 1; return s.map((v, i) => (i >= n && I.isNum(v) && I.isNum(s[i - n]) ? v - s[i - n] : null)); },
      abs: (a) => (argc('abs', a, 1, 1), elem(a[0], 0, (x) => Math.abs(x))),
      max: (a) => (argc('max', a, 2, 2), elem(a[0], a[1], Math.max)),
      min: (a) => (argc('min', a, 2, 2), elem(a[0], a[1], Math.min)),
    };
    const ACTIONS = new Set(['plot', 'panel', 'alert', 'hline', 'buy', 'sell']);
    const DEFAULTS = { alert: ['#3ddc97', null], buy: ['#3ddc97', 'Kauf'], sell: ['#ff6b7a', 'Verkauf'] };

    function ev(n) {
      switch (n.k) {
        case 'num': return n.v;
        case 'str': return n.v;
        case 'var':
          if (own(base, n.name)) return base[n.name];
          if (own(vars, n.name)) return vars[n.name];
          throw new Error(`Zeile ${n.line}: unbekannter Name „${n.name}“`);
        case 'neg': return elem(ev(n.e), 0, (x) => -x);
        case 'not': return elem(ev(n.e), 0, (x) => (x ? 0 : 1));
        case 'bin': {
          const l = ev(n.l), r = ev(n.r);
          if (typeof l === 'string' || typeof r === 'string') throw new Error('Mit Text kann nicht gerechnet werden');
          const ops = {
            '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => (b === 0 ? NaN : a / b),
            '>': (a, b) => +(a > b), '<': (a, b) => +(a < b), '>=': (a, b) => +(a >= b), '<=': (a, b) => +(a <= b),
            '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b), and: (a, b) => +(!!a && !!b), or: (a, b) => +(!!a || !!b),
          };
          const res = elem(l, r, ops[n.op]);
          return isSeries(res) ? res.map((v) => (Number.isFinite(v) ? v : null)) : res;
        }
        case 'call': {
          if (ACTIONS.has(n.name)) throw new Error(`Zeile ${n.line}: ${n.name}() nur als eigene Zeile erlaubt`);
          const f = Object.prototype.hasOwnProperty.call(FUNCS, n.name) ? FUNCS[n.name] : null;
          if (!f) throw new Error(`Zeile ${n.line}: unbekannte Funktion „${n.name}“`);
          return f(n.args.map(ev));
        }
      }
      throw new Error('Interner Fehler');
    }
    function label(node) {
      switch (node.k) {
        case 'num': return String(node.v);
        case 'var': return node.name;
        case 'neg': return '-' + label(node.e);
        case 'not': return 'not ' + label(node.e);
        case 'bin': return `${label(node.l)} ${node.op} ${label(node.r)}`;
        case 'call': return `${node.name}(${node.args.map(label).join(', ')})`;
        default: return '"' + node.v + '"';
      }
    }
    for (const st of prog) {
      if (st.k === 'assign') {
        if (own(base, st.name) || own(FUNCS, st.name) || ACTIONS.has(st.name) || st.name.startsWith('__')) throw new Error(`„${st.name}“ ist reserviert`);
        vars[st.name] = ev(st.e); continue;
      }
      const e = st.e;
      if (e.k === 'call' && ACTIONS.has(e.name)) {
        if (outputs.length >= LIMITS.maxOutputs) throw new Error('Zu viele Ausgaben');
        if (!e.args.length) throw new Error(`${e.name}() braucht ein Argument`);
        const val = num(ev(e.args[0]));
        const extra = e.args.slice(1).map(ev);
        const str = extra.filter((x) => typeof x === 'string');
        let color = null, title = null;
        for (const s of str) { const c = COLORS[s.toLowerCase()] || (/^#[0-9a-f]{3,8}$/i.test(s) ? s : null); if (c && !color) color = c; else if (!title) title = s; }
        const d = DEFAULTS[e.name] || [null, null];
        outputs.push({ type: e.name, values: val, color: color || d[0] || PALETTE[outputs.length % PALETTE.length], title: title || d[1] || label(e.args[0]) });
      } else {
        // Ein nackter Ausdruck wird automatisch gezeichnet
        outputs.push({ type: 'plot', values: num(ev(e)), color: PALETTE[outputs.length % PALETTE.length], title: label(e) });
      }
    }
    return outputs;
  }

  const api = { tokenize, parse, run, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MiniScript = api;
})(typeof window !== 'undefined' ? window : globalThis);
