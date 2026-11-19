const $ = (id) => document.getElementById(id);
const { esc } = App;
let S = {}, icons = {};
const set = (patch) => window.lumen.update(patch);

const NAV = [
  ['generale', 'gear'], ['prestazioni', 'cpu'], ['aspetto', 'contrast'], ['dock', 'grid'], ['app', 'plus'], ['barra', 'sliders'], null,
  ['ricerca', 'search'], ['appunti', 'clipboard'], ['snippet', 'text'], ['widget', 'widgets'], ['angoli', 'desktop'], ['finestre', 'layout'], ['concentrazione', 'timer'], null,
  ['profili', 'play'], ['strumenti', 'edit'],
  ['sfondo', 'image'],
];
const ACCENTS = ['#0a84ff', '#bf5af2', '#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#8e8e93'];
const PRESETS = [
  { id: 'demoniaccio', skin: 'demoniaccio', theme: 'dark', accent: '#d11f3d', dockSize: 54, dockMagnify: true, img: 'skins/demoniaccio/preview.jpg', bar: '#0e080bdd', dock: '#120a0ecc' },
  { id: 'minimal', theme: 'light', accent: '#0a84ff', dockSize: 50, dockMagnify: true, bg: '#f2f2f5', bar: '#ffffff', dock: '#ffffffcc' },
  { id: 'night', theme: 'dark', accent: '#bf5af2', dockSize: 54, dockMagnify: true, bg: '#17171b', bar: '#26262b', dock: '#2e2e34cc' },
  { id: 'graphite', theme: 'dark', accent: '#8e8e93', dockSize: 46, dockMagnify: false, bg: '#2a2a2d', bar: '#38383c', dock: '#45454acc' },
  { id: 'ocean', theme: 'auto', accent: '#64d2ff', dockSize: 56, dockMagnify: true, bg: 'linear-gradient(135deg,#0b3d91,#1fa2ff)', bar: '#ffffff55', dock: '#ffffff66' },
];
const CORNER_OPTS = ['none', 'launcher', 'control', 'mission', 'panel', 'desktop', 'lock', 'widgets', 'clipboard', 'settings'];
const SNAP = [
  ['left', 'Ctrl+Alt+←'], ['right', 'Ctrl+Alt+→'], ['top', 'Ctrl+Alt+↑'], ['bottom', 'Ctrl+Alt+↓'], ['max', 'Ctrl+Alt+Enter'], ['almost', 'Ctrl+Alt+M'], ['center', 'Ctrl+Alt+C'],
  ['tl', 'Ctrl+Alt+U'], ['tr', 'Ctrl+Alt+I'], ['bl', 'Ctrl+Alt+J'], ['br', 'Ctrl+Alt+K'], ['left3', 'Ctrl+Alt+D'], ['center3', 'Ctrl+Alt+F'], ['right3', 'Ctrl+Alt+G'],
];
const WIDGETS = [['clock', 'timer'], ['weather', 'sun'], ['calendar', 'grid'], ['notes', 'edit'], ['system', 'cpu']];
const PHASES = ['dawn', 'day', 'dusk', 'night'];

// ---------- Navigazione ----------
function buildNav() {
  const nav = $('nav');
  nav.querySelectorAll('button, .sep').forEach(e => e.remove());
  for (const n of NAV) {
    if (!n) { nav.insertAdjacentHTML('beforeend', '<div class="sep"></div>'); continue; }
    nav.insertAdjacentHTML('beforeend', `<button data-tab="${n[0]}">${App.icon(n[1])}<span>${esc(t('nav.' + n[0]))}</span></button>`);
  }
  showTab(current);
}
let current = 'generale';
function showTab(id) {
  current = id;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('section').forEach(s => s.classList.toggle('active', s.id === id));
  if (id === 'generale') refreshGeneral();
  if (id === 'prestazioni' && window.Perf) window.Perf.refresh();
}
$('nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
window.lumen.on('tab', showTab);

// ---------- Controlli generici [data-k] ----------
document.querySelectorAll('[data-k]').forEach(el => {
  const k = el.dataset.k;
  if (el.type === 'checkbox') el.addEventListener('change', () => set({ [k]: el.checked }));
  else if (el.type === 'range') {
    let tm;
    el.addEventListener('input', () => { showVal(k, +el.value); clearTimeout(tm); tm = setTimeout(() => set({ [k]: +el.value }), 60); });
  } else if (el.tagName === 'SELECT') el.addEventListener('change', () => set({ [k]: 'num' in el.dataset ? +el.value : el.value }));
  else if (el.type === 'number') el.addEventListener('change', () => {
    const v = Math.max(+el.min || 1, Math.min(+el.max || 999, Math.round(+el.value || 0)));
    el.value = v; set({ [k]: v });
  });
  else if (el.type === 'text') { let tm; el.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => set({ [k]: el.value.trim() }), 500); }); }
});
function showVal(k, v) {
  if (k === 'dockSize') $('dockSizeV').textContent = v;
  if (k === 'dockMagnifyScale') $('dockMagnifyScaleV').textContent = (+v).toFixed(2) + '×';
}
function syncControls() {
  document.querySelectorAll('[data-k]').forEach(el => {
    const v = S[el.dataset.k];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = v ?? '';
    if (el.type === 'range') showVal(el.dataset.k, v);
  });
  document.querySelector('[data-k=dockMagnifyScale]').disabled = !S.dockMagnify;
}

// ---------- Segmenti e colori ----------
const seg = (id, key) => {
  $(id).addEventListener('click', (e) => { const v = e.target.dataset.v; if (v) set({ [key]: v }); });
  return () => $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === S[key]));
};
const segs = [seg('theme', 'theme'), seg('lang', 'lang'), seg('wpMode', 'wallpaperMode')];

$('accent').innerHTML = ACCENTS.map(c => `<button data-c="${c}" style="background:${c}"></button>`).join('');
$('accent').addEventListener('click', (e) => { if (e.target.dataset.c) set({ accent: e.target.dataset.c }); });

function renderPresets() {
  $('presets').innerHTML = PRESETS.map(p => `<div class="preset ${(S.skin || 'default') === (p.skin || 'default') && (p.skin || S.accent === p.accent) ? 'on' : ''}" data-p="${p.id}">
    <div class="pv" style="${p.img ? `background:#000 url('${p.img}') center/cover` : `background:${p.bg}`}"><b style="background:${p.bar}"></b><i style="background:${p.dock};box-shadow:0 0 0 1px ${p.accent}55"></i></div>${esc(t('preset.' + p.id))}</div>`).join('');
}
$('presets').addEventListener('click', (e) => {
  const el = e.target.closest('[data-p]'); if (!el) return;
  const p = PRESETS.find(x => x.id === el.dataset.p);
  window.lumen.applyPreset({ skin: p.skin || 'default', settings: { theme: p.theme, accent: p.accent, dockSize: p.dockSize, dockMagnify: p.dockMagnify } });
});
$('exportTheme').onclick = () => window.lumen.exportTheme();
$('importTheme').onclick = async () => { const ok = await window.lumen.importTheme(); if (ok === false) alert(t('s.importFail')); };

// ---------- Generale ----------
async function refreshGeneral() {
  $('ver').textContent = S.version || '';
  const mb = await window.lumen.memory();
  $('mem').textContent = Math.round(mb / 1024 / 1024) + ' MB';
  const avail = await window.lumen.updaterAvailable();
  $('updHint').textContent = avail ? '' : t('s.updUnconfigured');
}
$('checkUpd').onclick = async () => {
  $('updHint').textContent = t('s.checking');
  const r = await window.lumen.checkUpdates();
  $('updHint').textContent = t('upd.' + r.status, { v: r.version || '' }) + (r.error ? ' (' + r.error + ')' : '');
};
$('reWelcome').onclick = () => window.lumen.openSettings('__welcome');
$('quit').onclick = () => window.lumen.quit();

// ---------- App nel Dock ----------
const ICON_EDIT = App.icon('image'), ICON_DEL = App.icon('trash');
function renderApps() {
  const list = $('appList');
  if (!S.apps.length) { list.innerHTML = `<div class="row hint">${esc(t('s.noApps'))}</div>`; return; }
  list.innerHTML = S.apps.map(a => `
    <div class="row" draggable="true" data-id="${a.id}">
      <div class="app-main">
        <div class="app-ico ${a.icon ? 'custom' : ''}">${a.type === 'folder' ? App.icon('folder') : icons[a.id] ? `<img src="${icons[a.id]}">` : a.glyph ? App.icon(a.glyph) : esc((a.name || '?')[0])}</div>
        <div style="min-width:0;flex:1"><input value="${esc(a.name)}" data-rename="${a.id}"><div class="app-path">${esc(a.type === 'folder' ? t('s.folderStack') + ' · ' + a.path : a.path)}</div></div>
      </div>
      ${a.type === 'folder' ? '' : `<button class="icon-btn" title="${esc(t('s.customIcon'))}" data-icon="${a.id}">${ICON_EDIT}</button>`}
      <button class="icon-btn" title="${esc(t('s.remove'))}" data-del="${a.id}">${ICON_DEL}</button>
    </div>`).join('');
}
const appList = $('appList');
appList.addEventListener('change', (e) => {
  const id = e.target.dataset.rename; if (!id) return;
  set({ apps: S.apps.map(a => a.id === id ? { ...a, name: e.target.value.trim() || a.name } : a) });
});
appList.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
appList.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]'), ic = e.target.closest('[data-icon]');
  if (del) set({ apps: S.apps.filter(a => a.id !== del.dataset.del) });
  if (ic) { const p = await window.lumen.pickImage(); if (p) set({ apps: S.apps.map(a => a.id === ic.dataset.icon ? { ...a, icon: p } : a) }); }
});
let dragId = null;
appList.addEventListener('dragstart', (e) => { const r = e.target.closest('.row'); if (r) { dragId = r.dataset.id; r.classList.add('dragging'); } });
appList.addEventListener('dragend', (e) => { e.target.closest('.row')?.classList.remove('dragging'); appList.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });
appList.addEventListener('dragover', (e) => { e.preventDefault(); appList.querySelectorAll('.over').forEach(x => x.classList.remove('over')); e.target.closest('.row')?.classList.add('over'); });
appList.addEventListener('drop', (e) => {
  e.preventDefault();
  const r = e.target.closest('.row'); if (!r || !dragId || r.dataset.id === dragId) return;
  const apps = [...S.apps];
  const [m] = apps.splice(apps.findIndex(a => a.id === dragId), 1);
  apps.splice(apps.findIndex(a => a.id === r.dataset.id), 0, m);
  dragId = null; set({ apps });
});
$('addApp').onclick = async () => { const a = await window.lumen.pickApps(); if (a && a.length) set({ apps: [...S.apps, ...a] }); };
$('addFolder').onclick = async () => { const f = await window.lumen.pickFolder(); if (f) set({ apps: [...S.apps, f] }); };
$('addInstalled').onclick = async () => {
  const chosen = await window.AppPicker.openAppPicker(new Set(S.apps.map(a => a.path)));
  if (chosen && chosen.length) set({ apps: [...S.apps, ...chosen.map(a => ({ id: Math.random().toString(36).slice(2, 10), type: 'app', name: a.name, path: a.path, iconSrc: a.iconSrc || undefined, exe: a.exe || undefined }))] });
};

// ---------- Barra delle applicazioni di Windows ----------
async function refreshTaskbar() {
  const h = await window.lumen.taskbarGet();
  $('winTaskbar').checked = !!h;
  $('winTaskbar').disabled = h === null;
}
$('winTaskbar').addEventListener('change', async (e) => {
  e.target.disabled = true;
  const h = await window.lumen.taskbarSet(e.target.checked);
  e.target.checked = !!h; e.target.disabled = false;
});
refreshTaskbar();
window.addEventListener('focus', refreshTaskbar); // se l'utente la cambia dalle impostazioni di Windows

// ---------- Ricerca ----------
function renderTips() {
  const rows = [['12*(3+4)', t('tip.calc')], ['10 km in mi', t('tip.units')], ['50 eur in usd', t('tip.currency')], ['yt lofi', t('tip.yt')], ['g / w / maps / gh …', t('tip.prefix')], [t('tip.cmdEx'), t('tip.cmd')], ['Ctrl+D', t('tip.pin')]];
  $('tips').innerHTML = rows.map(r => `<tr><td><kbd>${esc(r[0])}</kbd></td><td>${esc(r[1])}</td></tr>`).join('');
}
async function shortcutStatus() {
  const st = await window.lumen.shortcutStatus();
  const show = (el, name, enabled) => { el.textContent = enabled && st[name] === false ? t('s.shortcutBusy') : ''; el.className = 'hint ' + (enabled && st[name] === false ? 'warn' : ''); };
  show($('lsStatus'), 'launcher', S.launcherEnabled);
  show($('csStatus'), 'clipboard', S.clipboardEnabled);
}

// ---------- Widget ----------
function renderWidgets() {
  $('widgetList').innerHTML = WIDGETS.map(([w, ic]) => `<div class="row"><span style="display:flex;gap:10px;align-items:center">${App.icon(ic)}${esc(t('w.' + w))}</span>
    <label class="sw"><input type="checkbox" data-wid="${w}" ${S.widgets[w] && S.widgets[w].on ? 'checked' : ''} ${S.widgetsEnabled ? '' : 'disabled'}><span></span></label></div>`).join('');
}
$('widgetList').addEventListener('change', (e) => { const w = e.target.dataset.wid; if (w) set({ widgets: { [w]: { on: e.target.checked } } }); });

// ---------- Angoli ----------
function renderCorners() {
  const box = $('corners');
  box.querySelectorAll('select').forEach(s => s.remove());
  for (const c of ['tl', 'tr', 'bl', 'br']) {
    box.insertAdjacentHTML('beforeend', `<select data-c="${c}">${CORNER_OPTS.map(o => `<option value="${o}" ${S.hotCorners[c] === o ? 'selected' : ''}>${esc(t('corner.' + o))}</option>`).join('')}</select>`);
  }
}
$('corners').addEventListener('change', (e) => { const c = e.target.dataset.c; if (c) set({ hotCorners: { [c]: e.target.value } }); });

// ---------- Finestre ----------
function renderSnap() {
  $('snapKeys').innerHTML = SNAP.map(([k, key]) => `<tr><td>${esc(t('snap.' + k))}</td><td><kbd>${esc(key)}</kbd></td></tr>`).join('');
}
function renderLayouts() {
  $('layoutList').innerHTML = S.layouts.length ? S.layouts.map(l => `<div class="row"><span>${esc(l.name)}<span class="hint">${esc(t('s.layoutCount', { n: l.windows.length }))}</span></span>
    <div class="btns"><button class="btn" data-restore="${l.id}">${esc(t('s.restore'))}</button><button class="btn danger" data-dellayout="${l.id}">${esc(t('s.remove'))}</button></div></div>`).join('')
    : `<div class="row hint">${esc(t('s.noLayouts'))}</div>`;
}
$('layoutList').addEventListener('click', (e) => {
  const r = e.target.closest('[data-restore]'), d = e.target.closest('[data-dellayout]');
  if (r) window.lumen.restoreLayout(r.dataset.restore);
  if (d) set({ layouts: S.layouts.filter(l => l.id !== d.dataset.dellayout) });
});
$('saveLayout').onclick = async () => {
  const name = $('layoutName').value.trim() || t('s.layoutDefault', { n: S.layouts.length + 1 });
  await window.lumen.saveLayout(name);
  $('layoutName').value = '';
};

// ---------- Sfondo ----------
const fileUrl = (p) => `url("file:///${encodeURI(p.replace(/\\/g, '/'))}")`;
function renderWallpaper() {
  $('wpStatic').classList.toggle('hidden', S.wallpaperMode === 'dynamic');
  $('wpDynamic').classList.toggle('hidden', S.wallpaperMode !== 'dynamic');
  const prev = $('wpPrev');
  prev.style.backgroundImage = S.wallpaper ? fileUrl(S.wallpaper) : '';
  prev.textContent = S.wallpaper ? '' : t('s.noImage');
  $('wpGrid').innerHTML = PHASES.map(p => {
    const f = S.dynamicWallpapers[p];
    return `<div class="wp" data-phase="${p}"><div class="img" style="${f ? `background-image:${fileUrl(f)}` : ''}">${f ? '' : '+'}</div>${esc(t('phase.' + p))}</div>`;
  }).join('');
}
$('pickWp').onclick = async () => { const p = await window.lumen.pickImage(); if (p) set({ wallpaper: p }); };
$('wpGrid').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-phase]'); if (!el) return;
  const p = await window.lumen.pickImage(); if (p) set({ dynamicWallpapers: { [el.dataset.phase]: p } });
});

// ---------- Sincronizzazione ----------
App.init(async (s, first) => {
  S = s;
  if (first) buildNav(); else { document.querySelectorAll('nav button[data-tab] > span:not(.ico)').forEach(sp => { sp.textContent = t('nav.' + sp.parentElement.dataset.tab); }); }
  syncControls();
  segs.forEach(f => f());
  document.querySelectorAll('#accent button').forEach(b => b.classList.toggle('on', b.dataset.c === S.accent));
  renderPresets(); renderTips(); renderWidgets(); renderCorners(); renderSnap(); renderLayouts(); renderWallpaper();
  if (!document.activeElement || !document.activeElement.dataset || !document.activeElement.dataset.rename) {
    icons = await window.lumen.dockIcons();
    renderApps();
  }
  shortcutStatus();
  if (current === 'generale') refreshGeneral();
});
