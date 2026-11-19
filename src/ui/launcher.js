const $ = (id) => document.getElementById(id);
const q = $('q'), results = $('results'), panel = $('panel');
const { esc } = App;
$('sico').innerHTML = window.ICONS.search;

let items = [], sel = 0, seq = 0, fileTimer = null;

const WEB = {
  google: (s) => 'https://www.google.com/search?q=' + encodeURIComponent(s),
  duckduckgo: (s) => 'https://duckduckgo.com/?q=' + encodeURIComponent(s),
  bing: (s) => 'https://www.bing.com/search?q=' + encodeURIComponent(s),
};
const PREFIX = {
  g: (s) => ({ name: 'Google', url: WEB.google(s) }),
  yt: (s) => ({ name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(s) }),
  w: (s) => ({ name: 'Wikipedia', url: `https://${App.S.lang}.wikipedia.org/w/index.php?search=` + encodeURIComponent(s) }),
  maps: (s) => ({ name: 'Maps', url: 'https://www.google.com/maps/search/' + encodeURIComponent(s) }),
  gh: (s) => ({ name: 'GitHub', url: 'https://github.com/search?q=' + encodeURIComponent(s) }),
};

function iconHTML(it) {
  if (it.icon) return `<img src="${it.icon}">`;
  if (it.glyph) return App.icon(it.glyph);
  return `<span class="letter">${esc((it.name || '?')[0].toUpperCase())}</span>`;
}

function render(sections) {
  items = [];
  let html = '';
  for (const sec of sections) {
    if (!sec.items.length) continue;
    html += `<div class="sec">${esc(sec.title)}</div>`;
    for (const it of sec.items) {
      const i = items.push(it) - 1;
      html += `<div class="row ${it.big ? 'big' : ''}" data-i="${i}">
        <span class="ic">${iconHTML(it)}</span>
        <span class="txt"><span class="name">${esc(it.name)}</span>${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</span>
        ${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}
      </div>`;
    }
  }
  results.innerHTML = html;
  sel = Math.min(sel, Math.max(0, items.length - 1));
  highlight();
  footer();
  fit();
}

function highlight() {
  results.querySelectorAll('.row').forEach(r => r.classList.toggle('sel', Number(r.dataset.i) === sel));
  const el = results.querySelector('.row.sel');
  el && el.scrollIntoView({ block: 'nearest' });
  footer();
}

function footer() {
  const it = items[sel];
  const parts = [];
  if (it) {
    parts.push('↵ ' + (it.kind === 'copy' ? t('launcher.copy') : t('launcher.open')));
    if (it.kind === 'file') parts.push('Ctrl+↵ ' + t('launcher.reveal'));
    if (it.kind === 'app') parts.push('Ctrl+D ' + t('launcher.pin'));
  }
  $('foot').innerHTML = parts.map(esc).join('<span>·</span>');
}

function fit() {
  requestAnimationFrame(() => window.lumen.launcherHeight(panel.getBoundingClientRect().height + 50));
}

let base = { calc: [], apps: [], commands: [], snippets: [], browser: [], web: [] };
let files = [];

async function update() {
  const text = q.value;
  const my = ++seq;
  sel = 0;
  clearTimeout(fileTimer);
  files = [];
  if (!text.trim()) { base = { calc: [], apps: [], commands: [], snippets: [], browser: [], web: [] }; return render([]); }

  // Calcoli e conversioni (immediati)
  const calc = [];
  const v = window.Calc.calc(text);
  if (v !== null) calc.push({ kind: 'copy', big: true, name: '= ' + window.Calc.fmt(v), copy: String(+v.toFixed(10)), glyph: 'calc', hint: t('launcher.copyHint') });
  const conv = window.Calc.convert(text);
  if (conv && conv.type === 'unit') calc.push({ kind: 'copy', big: true, name: conv.label, copy: conv.result, glyph: 'swap', hint: t('launcher.copyHint') });

  // Prefissi web
  const web = [];
  const pm = /^(\w+)\s+(.+)$/.exec(text);
  if (pm && PREFIX[pm[1].toLowerCase()]) { const p = PREFIX[pm[1].toLowerCase()](pm[2]); web.push({ kind: 'url', url: p.url, name: t('launcher.searchOn', { s: pm[2], e: p.name }), glyph: 'globe' }); }
  web.push({ kind: 'url', url: (WEB[App.S.launcherWeb] || WEB.google)(text), name: t('launcher.searchWeb', { s: text }), glyph: 'globe', hint: t('launcher.web') });

  const r = await window.lumen.search(text);
  if (my !== seq) return;
  base = {
    calc,
    apps: r.apps.map(a => ({ ...a, sub: '' })),
    commands: [...r.commands.map(c => ({ ...c, hint: t('launcher.command') })), ...(r.extra || []).filter(x => x.section === 'commands')].slice(0, 6),
    snippets: (r.extra || []).filter(x => x.section === 'snippets').slice(0, 4),
    browser: (r.extra || []).filter(x => x.section === 'browser'),
    web,
  };
  draw();

  if (conv && conv.type === 'currency') {
    const c = await window.lumen.currency(conv.amount, conv.from, conv.to);
    if (my !== seq || !c) return;
    base.calc.unshift({ kind: 'copy', big: true, glyph: 'swap', name: `${window.Calc.fmt(conv.amount)} ${conv.from} = ${window.Calc.fmt(+c.value.toFixed(2))} ${conv.to}`,
      copy: c.value.toFixed(2), hint: t('launcher.rate', { r: c.rate.toFixed(4) }) });
    draw();
  }

  if (v !== null || conv) return; // calcoli e conversioni: niente ricerca file
  fileTimer = setTimeout(async () => {
    const f = await window.lumen.searchFiles(text);
    if (my !== seq) return;
    files = (f || []).map(x => ({ kind: 'file', name: x.name, path: x.path, sub: x.path, icon: x.icon, glyph: 'file' }));
    draw();
  }, 220);
}

function draw() {
  const keep = items[sel];
  render([
    { title: t('launcher.result'), items: base.calc },
    { title: t('launcher.apps'), items: base.apps },
    { title: t('launcher.commands'), items: base.commands },
    { title: t('launcher.snippets'), items: base.snippets },
    { title: t('launcher.files'), items: files },
    { title: t('launcher.browser'), items: base.browser },
    { title: t('launcher.web'), items: base.web },
  ]);
  if (keep) { const i = items.findIndex(x => x.name === keep.name && x.kind === keep.kind); if (i >= 0) { sel = i; highlight(); } }
}

function run(it, alt) {
  if (!it) return;
  if (it.kind === 'copy') { navigator.clipboard.writeText(it.copy); return window.lumen.hideLauncher(); }
  if (it.kind === 'file' && alt) return window.lumen.run({ kind: 'reveal', path: it.path });
  window.lumen.run({ kind: it.kind, path: it.path, url: it.url, id: it.id });
}

q.addEventListener('input', update);
q.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); highlight(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); highlight(); e.preventDefault(); }
  else if (e.key === 'Enter') { run(items[sel], e.ctrlKey); e.preventDefault(); }
  else if (e.key === 'Escape') { if (q.value) { q.value = ''; update(); } else window.lumen.hideLauncher(); }
  else if (e.key.toLowerCase() === 'd' && e.ctrlKey) {
    const it = items[sel];
    if (it && it.kind === 'app') { window.lumen.pin({ name: it.name, path: it.path }); it.hint = '✓ ' + t('launcher.pinned'); draw(); }
    e.preventDefault();
  }
});
results.addEventListener('mousemove', (e) => {
  if (!e.movementX && !e.movementY) return; // il contenuto si è spostato sotto il cursore fermo
  const r = e.target.closest('.row'); if (r && Number(r.dataset.i) !== sel) { sel = Number(r.dataset.i); highlight(); } });
results.addEventListener('click', (e) => { const r = e.target.closest('.row'); if (r) run(items[Number(r.dataset.i)], e.ctrlKey); });

window.lumen.on('launcher-open', () => {
  q.select(); q.focus();
  panel.classList.remove('pop'); void panel.offsetWidth; panel.classList.add('pop');
  if (q.value) update(); else fit();
});
window.lumen.on('launcher-test', (text) => { q.value = text; update(); });

App.init(() => { fit(); });
