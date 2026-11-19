const $ = (id) => document.getElementById(id);
const { esc } = App;
const D = window.lumen.disk;
const size = (b) => b >= 1024 ** 4 ? (b / 1024 ** 4).toFixed(2) + ' TB' : b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + ' GB' : b >= 1024 ** 2 ? (b / 1024 ** 2).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';
const spin = () => `<div class="loading"><span class="spin"></span>${esc(t('disk.scanning'))}</div>`;
let home = 'C:\\', targets = null;

['grid', 'search', 'file', 'trash', 'layout', 'text'].forEach((ic, i) => { $('i' + (i + 1)).innerHTML = window.ICONS[ic]; });

// ---------- Navigazione ----------
const loaded = {};
function show(tab) {
  document.querySelectorAll('nav button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('section').forEach(s => s.classList.toggle('active', s.id === tab));
  if (!loaded[tab]) { loaded[tab] = true; ({ over: loadOver, explore: () => explore(home), clean: loadTargets }[tab] || (() => {}))(); }
}
$('nav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
$('classic').onclick = () => D.classic();

// ---------- Panoramica ----------
async function loadOver() {
  const [drives, admin] = await Promise.all([D.drives(), D.admin()]);
  $('drives').innerHTML = (drives || []).map(d => {
    const f = d.size ? d.used / d.size : 0;
    const col = f > 0.9 ? '#ff453a' : f > 0.75 ? '#ff9f0a' : '#30d158';
    return `<div class="drive"><b>${esc(d.drive)}</b><div><div class="meter"><i style="width:${(f * 100).toFixed(1)}%;background:${col}"></i></div>
      <div class="hint" style="margin-top:5px">${esc(d.label || '')} ${esc(t('disk.used', { u: size(d.used), s: size(d.size) }))}</div></div>
      <span><b>${size(d.free)}</b> <span class="hint">${esc(t('disk.free'))}</span></span></div>`;
  }).join('') || `<div class="row hint">—</div>`;
  $('adminHint').textContent = admin ? '' : t('disk.notAdmin');
  loaded.clean = true; // la scheda Pulizia riusa questa analisi
  await loadTargets();
}
$('goClean').onclick = () => show('clean');

// ---------- Esplora ----------
let exPath = null;
async function explore(p) {
  exPath = p;
  const parts = p.replace(/\\+$/, '').split('\\');
  $('crumbs').innerHTML = parts.map((s, i) => `<a data-crumb="${esc(parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : ''))}">${esc(s)}</a>`).join('<span>›</span>');
  $('exList').innerHTML = spin();
  const items = await D.children(p);
  const total = items.reduce((s, x) => s + x.bytes, 0) || 1;
  $('exList').innerHTML = items.length ? items.map((x, i) => `
    <div class="item ${x.isDir ? 'dir' : ''}" data-i="${i}">
      ${App.icon(x.isDir ? 'folder' : 'file')}
      <span class="nm">${esc(x.name)}${x.isDir ? `<small>${esc(t('disk.files', { n: x.files.toLocaleString() }))}</small>` : ''}</span>
      <span class="bar"><i style="width:${(x.bytes / total * 100).toFixed(1)}%"></i></span>
      <span class="sz">${size(x.bytes)}</span>
      <span class="acts"><button class="mini" data-reveal="${i}">${esc(t('disk.show'))}</button></span>
    </div>`).join('') : `<div class="row hint">${esc(t('disk.empty'))}</div>`;
  $('exList')._items = items;
}
$('crumbs').addEventListener('click', (e) => { const a = e.target.closest('[data-crumb]'); if (a) explore(a.dataset.crumb); });
$('exList').addEventListener('click', (e) => {
  const items = $('exList')._items || [];
  const r = e.target.closest('[data-reveal]');
  if (r) return D.reveal(items[r.dataset.reveal].path);
  const it = e.target.closest('.item.dir');
  if (it) explore(items[it.dataset.i].path);
});
$('exPick').onclick = async () => { const p = await D.pickFolder(); if (p) explore(p); };
$('exOpen').onclick = () => exPath && D.openPath(exPath);

// ---------- File più grandi ----------
let bigPath = null, bigItems = [];
function setBigPath(p) { bigPath = p; $('bigPath').textContent = p; }
$('bigPick').onclick = async () => { const p = await D.pickFolder(); if (p) setBigPath(p); };
$('bigScan').onclick = async () => {
  $('bigList').innerHTML = spin(); $('bigTrash').disabled = true;
  bigItems = await D.top(bigPath);
  const max = bigItems[0] ? bigItems[0].bytes : 1;
  $('bigList').innerHTML = bigItems.length ? bigItems.map((x, i) => `
    <div class="item"><input type="checkbox" data-ck="${i}">
      <span class="nm">${esc(x.name)}<small>${esc(x.path)} · ${esc(new Date(x.modified).toLocaleDateString())}</small></span>
      <span class="bar"><i style="width:${(x.bytes / max * 100).toFixed(1)}%"></i></span>
      <span class="sz">${size(x.bytes)}</span>
      <span class="acts"><button class="mini" data-reveal="${i}">${esc(t('disk.show'))}</button></span></div>`).join('')
    : `<div class="row hint">${esc(t('disk.noBig'))}</div>`;
};
$('bigList').addEventListener('change', () => { $('bigTrash').disabled = !$('bigList').querySelector('input:checked'); });
$('bigList').addEventListener('click', (e) => { const r = e.target.closest('[data-reveal]'); if (r) D.reveal(bigItems[r.dataset.reveal].path); });
$('bigTrash').onclick = async () => {
  const sel = [...$('bigList').querySelectorAll('input:checked')].map(c => bigItems[c.dataset.ck]);
  const done = await D.trash(sel.map(x => ({ path: x.path, bytes: x.bytes })));
  if (done) { bigItems = bigItems.filter(x => !done.includes(x.path)); $('bigScan').click(); }
};

// ---------- Pulizia ----------
async function loadTargets() {
  $('cleanList').innerHTML = spin();
  targets = await D.targets();
  const total = targets.reduce((s, x) => s + (x.blocked ? 0 : x.bytes), 0);
  $('recl').textContent = size(total);
  const max = Math.max(1, ...targets.map(x => x.bytes));
  $('cleanList').innerHTML = targets.map((x, i) => `
    <div class="item"><input type="checkbox" data-t="${i}" ${x.blocked || !x.bytes ? 'disabled' : ''}>
      <span class="nm">${esc(x.name)}${x.blocked ? `<span class="tag warn">${esc(t('perf.admin'))}</span>` : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}</span>
      <span class="bar"><i style="width:${(x.bytes / max * 100).toFixed(1)}%"></i></span>
      <span class="sz">${size(x.bytes)}</span><span></span></div>`).join('');
  updateClean();
}
function updateClean() {
  const sel = [...$('cleanList').querySelectorAll('input:checked')].map(c => targets[c.dataset.t]);
  const s = sel.reduce((a, x) => a + x.bytes, 0);
  $('cleanTotal').textContent = sel.length ? t('disk.selected', { n: sel.length, s: size(s) }) : '';
  $('cleanRun').disabled = !sel.length;
}
$('cleanList').addEventListener('change', updateClean);
$('cleanAll').onclick = () => { $('cleanList').querySelectorAll('input:not(:disabled)').forEach(c => { c.checked = true; }); updateClean(); };
$('cleanRun').onclick = async () => {
  const sel = [...$('cleanList').querySelectorAll('input:checked')].map(c => ({ name: targets[c.dataset.t].name, bytes: targets[c.dataset.t].bytes }));
  $('cleanRun').disabled = true;
  const r = await D.clean(sel);
  if (!r) return updateClean();
  const freed = r.reduce((s, x) => s + (x.bytes || 0), 0), failed = r.reduce((s, x) => s + (x.failed || 0), 0);
  $('cleanRes').innerHTML = `<span class="done">✓ ${esc(t('disk.freed', { s: size(freed) }))}</span>${failed ? ' · ' + esc(t('disk.inUse', { n: failed })) : ''}`;
  loadTargets();
};

// ---------- Sviluppo ----------
let devPath = null, devItems = [];
function setDevPath(p) { devPath = p; $('devPath').textContent = p; }
$('devPick').onclick = async () => { const p = await D.pickFolder(); if (p) setDevPath(p); };
$('devScan').onclick = async () => {
  $('devList').innerHTML = spin();
  devItems = await D.dev(devPath);
  $('devList').innerHTML = devItems.length ? devItems.map((x, i) => `
    <div class="item"><input type="checkbox" data-d="${i}">
      <span class="nm">${esc(x.name)}<small>${esc(x.path)}</small></span>
      <span class="hint">${esc(t('disk.age', { n: x.ageDays }))}</span>
      <span class="sz">${size(x.bytes)}</span><span></span></div>`).join('')
    : `<div class="row hint">${esc(t('disk.noDev'))}</div>`;
  $('devRun').disabled = true;
};
$('devList').addEventListener('change', () => { $('devRun').disabled = !$('devList').querySelector('input:checked'); });
$('devOld').onclick = () => { $('devList').querySelectorAll('input[data-d]').forEach(c => { c.checked = devItems[c.dataset.d].ageDays > 30; }); $('devRun').disabled = !$('devList').querySelector('input:checked'); };
$('devRun').onclick = async () => {
  const sel = [...$('devList').querySelectorAll('input:checked')].map(c => ({ path: devItems[c.dataset.d].path, bytes: devItems[c.dataset.d].bytes }));
  const r = await D.devClean(sel);
  if (r) $('devScan').click();
};

// ---------- Report ----------
let repPath = null;
$('repPick').onclick = async () => { const p = await D.pickFolder(); if (p) { repPath = p; $('repPath').textContent = p; } };
$('repRun').onclick = async () => {
  $('repRun').disabled = true; $('repRes').innerHTML = `<span class="spin"></span>${esc(t('disk.reportWorking'))}`;
  const out = await D.report(repPath);
  $('repRun').disabled = false;
  $('repRes').textContent = out ? t('disk.reportDone') : t('disk.reportFail');
};

App.init(async (s, first) => {
  if (!first) return;
  home = await D.home();
  setBigPath(home); setDevPath(home); repPath = home; $('repPath').textContent = home;
  show('over');
});
