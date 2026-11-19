// Calcolatrice sicura (niente eval) + conversioni di unità.
(function () {
  const FUNCS = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil };
  const CONSTS = { pi: Math.PI, e: Math.E };

  function tokenize(src) {
    const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '.').replace(/\s+/g, '');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; const n = parseFloat(s.slice(i, j)); if (isNaN(n)) throw 0; out.push({ n }); i = j; continue; }
      if (/[a-z]/i.test(c)) { let j = i; while (j < s.length && /[a-z]/i.test(s[j])) j++; out.push({ id: s.slice(i, j).toLowerCase() }); i = j; continue; }
      if ('+-*/^%()'.includes(c)) { out.push({ op: c }); i++; continue; }
      throw 0;
    }
    return out;
  }

  // expr := term (('+'|'-') term)* ; term := unary (('*'|'/'|'%') unary)* ; unary := '-' unary | pow ; pow := atom ('^' unary)?
  function parse(tokens) {
    let p = 0;
    const peek = () => tokens[p], take = () => tokens[p++];
    const isOp = (o) => peek() && peek().op === o;
    function expr() { let v = term(); while (isOp('+') || isOp('-')) { const o = take().op; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
    function term() {
      let v = unary();
      for (;;) {
        if (isOp('*') || isOp('/')) { const o = take().op; const r = unary(); v = o === '*' ? v * r : v / r; }
        else if (isOp('%')) { take(); if (!peek() || peek().op === ')' || peek().op === '+' || peek().op === '-') v = v / 100; else v = v % unary(); }
        else if (peek() && (peek().n !== undefined || peek().id || isOp('('))) v = v * unary(); // moltiplicazione implicita: 2(3) 2pi
        else return v;
      }
    }
    function unary() { if (isOp('-')) { take(); return -unary(); } if (isOp('+')) { take(); return unary(); } return pow(); }
    function pow() { const b = atom(); if (isOp('^')) { take(); return Math.pow(b, unary()); } return b; }
    function atom() {
      const tk = take();
      if (!tk) throw 0;
      if (tk.n !== undefined) return tk.n;
      if (tk.op === '(') { const v = expr(); if (!isOp(')')) throw 0; take(); return v; }
      if (tk.id) {
        if (tk.id in CONSTS) return CONSTS[tk.id];
        if (tk.id in FUNCS) { if (!isOp('(')) throw 0; take(); const v = expr(); if (!isOp(')')) throw 0; take(); return FUNCS[tk.id](v); }
      }
      throw 0;
    }
    const v = expr();
    if (p !== tokens.length) throw 0;
    return v;
  }

  function calc(q) {
    if (!/[0-9]/.test(q) || !/[-+*/^%()×÷]|sqrt|sin|cos|tan|log|ln|pi/i.test(q)) return null;
    try {
      const v = parse(tokenize(q));
      return Number.isFinite(v) ? v : null;
    } catch { return null; }
  }

  // --- Unità ---
  const U = {};
  const add = (dim, factor, ...names) => names.forEach(n => { U[n] = { dim, factor }; });
  add('len', 0.001, 'mm'); add('len', 0.01, 'cm'); add('len', 1, 'm', 'metri', 'metro', 'meters', 'meter'); add('len', 1000, 'km');
  add('len', 0.0254, 'in', 'inch', 'pollici', 'pollice'); add('len', 0.3048, 'ft', 'feet', 'piedi'); add('len', 0.9144, 'yd', 'yard'); add('len', 1609.344, 'mi', 'miglia', 'miles', 'mile');
  add('mass', 1e-6, 'mg'); add('mass', 0.001, 'g', 'grammi'); add('mass', 1, 'kg', 'chili'); add('mass', 1000, 't', 'ton');
  add('mass', 0.0283495, 'oz', 'once'); add('mass', 0.453592, 'lb', 'lbs', 'libbre');
  add('vol', 0.001, 'ml'); add('vol', 0.01, 'cl'); add('vol', 1, 'l', 'litri', 'litro'); add('vol', 3.78541, 'gal', 'galloni');
  add('data', 1, 'b', 'byte', 'bytes'); add('data', 1024, 'kb'); add('data', 1024 ** 2, 'mb'); add('data', 1024 ** 3, 'gb'); add('data', 1024 ** 4, 'tb');
  add('time', 1, 's', 'sec', 'secondi'); add('time', 60, 'min', 'minuti'); add('time', 3600, 'h', 'ore', 'ora', 'hours'); add('time', 86400, 'd', 'giorni', 'days'); add('time', 604800, 'settimane', 'weeks');
  add('speed', 1, 'km/h', 'kmh'); add('speed', 1.609344, 'mph'); add('speed', 3.6, 'm/s');
  const TEMP = { c: 'c', '°c': 'c', celsius: 'c', f: 'f', '°f': 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };

  const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CNY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'BRL', 'MXN', 'INR', 'KRW', 'HKD', 'SGD', 'NZD', 'ZAR'];
  const SYMBOLS = { '€': 'EUR', '$': 'USD', '£': 'GBP', '¥': 'JPY', euro: 'EUR', dollari: 'USD', dollars: 'USD', sterline: 'GBP' };

  function convert(q) {
    const m = /^\s*([\d.,]+)\s*([^\s\d]+(?:\/[a-z]+)?)\s+(?:in|to|a|=|->)\s+([^\s\d]+(?:\/[a-z]+)?)\s*$/i.exec(q);
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.'));
    let from = m[2].toLowerCase(), to = m[3].toLowerCase();
    if (isNaN(v)) return null;
    if (TEMP[from] && TEMP[to]) {
      const c = TEMP[from] === 'c' ? v : TEMP[from] === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
      const r = TEMP[to] === 'c' ? c : TEMP[to] === 'f' ? c * 9 / 5 + 32 : c + 273.15;
      return { type: 'unit', value: r, label: `${fmt(v)} ${m[2]} = ${fmt(r)} ${m[3]}`, result: fmt(r) + ' ' + m[3] };
    }
    if (U[from] && U[to] && U[from].dim === U[to].dim) {
      const r = v * U[from].factor / U[to].factor;
      return { type: 'unit', value: r, label: `${fmt(v)} ${m[2]} = ${fmt(r)} ${m[3]}`, result: fmt(r) + ' ' + m[3] };
    }
    const cf = SYMBOLS[from] || from.toUpperCase(), ct = SYMBOLS[to] || to.toUpperCase();
    if (CURRENCIES.includes(cf) && CURRENCIES.includes(ct) && cf !== ct) return { type: 'currency', amount: v, from: cf, to: ct };
    return null;
  }

  function fmt(n) {
    if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0)) return n.toExponential(6);
    return (Math.round(n * 1e10) / 1e10).toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'it-IT', { maximumFractionDigits: 10 });
  }

  window.Calc = { calc, convert, fmt };
})();
