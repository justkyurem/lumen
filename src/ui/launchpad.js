const $ = (id) => document.getElementById(id);
const { esc } = App;
$('sico').innerHTML = window.ICONS.search;
let apps = [], icons = {}, shown = [], page = 0, sel = -1, per = 35, cols = 7, wheelAt = 0;

// Quante icone stanno in una pagina, in base allo schermo
function layout() {
  const W = window.innerWidth, H = window.innerHeight - 150;
  const ic = Math.max(56, Math.min(92, Math.round(Math.min(W / 13, H / 7.2))));
  document.documentElement.style.setProperty('--ic', ic + 'px');
  const cell = ic + 46, cellH = ic + 50;
  cols = Math.max(4, Math.min(8, Math.floor((W * 0.86) / cell)));
  const rows = Math.max(3, Math.min(5, Math.floor(H / cellH)));
  per = cols * rows;
  return { cell, cellH };
}

function filter() {
  const q = $('q').value.trim().toLowerCase();
  shown = !q ? apps : apps
    .map(a => { const n = a.name.toLowerCase(); const i = n.indexOf(q); const w = n.split(/[\s\-_.]+/).some(x => x.startsWith(q)); return [i < 0 ? -1 : (i === 0 ? 0 : w ? 1 : 2), a]; })
    .filter(x => x[0] >= 0).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  sel = q && shown.length ? 0 : -1;
  page = 0;
}

function tile(a, i) {
  const ic = icons[a.name] ? `<img src="${icons[a.name]}" draggable="false">` : `<div class="letter">${esc((a.name || '?')[0].toUpperCase())}</div>`;
  return `<div class="app ${i === sel ? 'sel' : ''}" data-i="${i}" style="animation-delay:${Math.min(i % per, 20) * 12}ms" title="${esc(a.name)}"><div class="ic">${ic}</div><span>${esc(a.name)}</span></div>`;
}

function render() {
  const { cell, cellH } = layout();
  const n = Math.max(1, Math.ceil(shown.length / per));
  page = Math.max(0, Math.min(page, n - 1));
  let html = '';
  for (let p = 0; p < n; p++) {
    const slice = shown.slice(p * per, (p + 1) * per);
    html += `<div class="page" style="grid-template-columns:repeat(${cols}, ${cell}px);grid-auto-rows:${cellH}px">` +
      (slice.length ? slice.map((a, k) => tile(a, p * per + k)).join('') : `<div class="empty" style="grid-column:1/-1">${esc(t('lp.none'))}</div>`) + '</div>';
  }
  $('pages').innerHTML = html;
  $('pages').style.transform = `translateX(${-page * 100}vw)`;
  $('dots').innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<div class="dot ${i === page ? 'on' : ''}" data-p="${i}"></div>`).join('') : '';
}

function go(p) {
  const n = Math.max(1, Math.ceil(shown.length / per));
  p = Math.max(0, Math.min(n - 1, p));
  if (p === page) return;
  page = p;
  $('pages').style.transform = `translateX(${-page * 100}vw)`;
  document.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i === page));
}

function select(i) {
  if (!shown.length) return;
  sel = Math.max(0, Math.min(shown.length - 1, i));
  document.querySelectorAll('.app.sel').forEach(el => el.classList.remove('sel'));
  const el = document.querySelector(`.app[data-i="${sel}"]`);
  if (el) el.classList.add('sel');
  go(Math.floor(sel / per));
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('.app');
  if (a) return window.lumen.launchpadOpen(shown[Number(a.dataset.i)].name);
  const d = e.target.closest('.dot');
  if (d) return go(Number(d.dataset.p));
  if (!e.target.closest('.search')) window.lumen.launchpadHide();
});
document.addEventListener('contextmenu', (e) => {
  const a = e.target.closest('.app');
  if (a) { e.preventDefault(); window.lumen.launchpadContext(shown[Number(a.dataset.i)].name); }
});
document.addEventListener('wheel', (e) => {
  if (Date.now() - wheelAt < 450 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 20) return;
  wheelAt = Date.now();
  go(page + ((e.deltaY || e.deltaX) > 0 ? 1 : -1));
}, { passive: true });
document.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'Escape') { if ($('q').value) { $('q').value = ''; filter(); render(); } else window.lumen.launchpadHide(); }
  else if (k === 'Enter') { const a = shown[sel < 0 ? 0 : sel]; if (a) window.lumen.launchpadOpen(a.name); }
  else if (k === 'F5') window.lumen.launchpadRefresh();
  else if (k === 'PageDown') go(page + 1);
  else if (k === 'PageUp') go(page - 1);
  else if (k === 'ArrowRight') select(sel < 0 ? page * per : sel + 1);
  else if (k === 'ArrowLeft') select(sel < 0 ? page * per : sel - 1);
  else if (k === 'ArrowDown') select(sel < 0 ? page * per : sel + cols);
  else if (k === 'ArrowUp') select(sel < 0 ? page * per : sel - cols);
  else return;
  e.preventDefault();
});
$('q').addEventListener('input', () => { filter(); render(); });
window.addEventListener('resize', () => render());

window.lumen.on('launchpad', (d) => {
  apps = d.apps; icons = d.icons || {};
  $('q').value = ''; filter(); render(); $('q').focus();
});
window.lumen.on('launchpad-icons', (batch) => {
  Object.assign(icons, batch);
  for (const [name, url] of Object.entries(batch)) {
    const i = shown.findIndex(a => a.name === name);
    const el = i >= 0 && document.querySelector(`.app[data-i="${i}"] .ic`);
    if (el) el.innerHTML = `<img src="${url}" draggable="false">`;
  }
});
window.lumen.on('launchpad-remove', (name) => { apps = apps.filter(a => a.name !== name); filter(); render(); });
App.init(() => render());
