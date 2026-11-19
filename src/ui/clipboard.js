const $ = (id) => document.getElementById(id);
const { esc } = App;
$('sico').innerHTML = window.ICONS.search;
let all = [], shown = [], sel = 0, filter = 'all';

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.min', { n: Math.round(s / 60) });
  if (s < 86400) return t('time.hours', { n: Math.round(s / 3600) });
  return t('time.days', { n: Math.round(s / 86400) });
}

function render() {
  const q = $('q').value.trim().toLowerCase();
  shown = all.filter(i =>
    (filter === 'all' || (filter === 'pinned' ? i.pinned : i.type === filter)) &&
    (!q || (i.type === 'text' && i.text.toLowerCase().includes(q)) || (i.source || '').toLowerCase().includes(q)));
  // Fissati in cima
  shown.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  sel = Math.min(sel, Math.max(0, shown.length - 1));
  $('list').innerHTML = shown.length ? shown.map((i, n) => `
    <div class="it ${n === sel ? 'sel' : ''}" data-n="${n}">
      ${App.icon(i.type === 'image' ? 'image' : 'text')}
      <div class="body">
        <div class="txt">${i.type === 'image' ? esc(t('clip.image', { w: i.w, h: i.h })) : esc(i.text.replace(/\s+/g, ' ').slice(0, 120))}</div>
        <div class="meta">${esc([i.source, ago(i.ts)].filter(Boolean).join(' · '))}</div>
      </div>
      ${i.pinned ? `<span class="pinmark">${window.ICONS.pin}</span>` : ''}
    </div>`).join('') : `<div class="empty">${esc(t(all.length ? 'clip.noMatch' : 'clip.emptyList'))}</div>`;
  preview();
  keys();
}

function preview() {
  const i = shown[sel];
  const p = $('preview');
  if (!i) { p.innerHTML = ''; return; }
  p.innerHTML = i.type === 'image' ? `<img src="file:///${encodeURI(i.file.replace(/\\/g, '/'))}">` : `<pre>${esc(i.text.slice(0, 20000))}</pre>`;
  const img = p.querySelector('img');
  if (img) img.addEventListener('error', () => { img.src = i.thumb; }, { once: true });
  const sl = $('list').querySelector('.sel'); sl && sl.scrollIntoView({ block: 'nearest' });
}

function keys() {
  const i = shown[sel];
  $('keys').innerHTML = [
    '↵ ' + t('clip.paste'), 'Ctrl+↵ ' + t('clip.copyOnly'),
    'Ctrl+P ' + (i && i.pinned ? t('clip.unpin') : t('clip.pin')), 'Del ' + t('clip.delete'),
  ].map(esc).map(s => `<span>${s}</span>`).join('');
}

function select(n) {
  sel = Math.max(0, Math.min(shown.length - 1, n));
  $('list').querySelectorAll('.it').forEach(el => el.classList.toggle('sel', Number(el.dataset.n) === sel));
  preview(); keys();
}

$('q').addEventListener('input', () => { sel = 0; render(); });
document.addEventListener('keydown', (e) => {
  const i = shown[sel];
  if (e.key === 'ArrowDown') { select(sel + 1); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { select(sel - 1); e.preventDefault(); }
  else if (e.key === 'Enter' && i) { window.lumen.clipUse(i.id, !e.ctrlKey); e.preventDefault(); }
  else if (e.key === 'Escape') window.lumen.clipHide();
  else if (e.key === 'Delete' && i && (!$('q').value || document.activeElement !== $('q'))) { window.lumen.clipRemove(i.id); e.preventDefault(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'p' && i) { window.lumen.clipPin(i.id); e.preventDefault(); }
  else if (e.key === 'Tab') {
    const tabs = ['all', 'text', 'image', 'pinned'];
    setFilter(tabs[(tabs.indexOf(filter) + (e.shiftKey ? 3 : 1)) % 4]); e.preventDefault();
  }
});
$('list').addEventListener('click', (e) => { const r = e.target.closest('.it'); if (r) select(Number(r.dataset.n)); });
$('list').addEventListener('dblclick', (e) => { const r = e.target.closest('.it'); if (r) window.lumen.clipUse(shown[Number(r.dataset.n)].id, true); });
$('tabs').addEventListener('click', (e) => { if (e.target.dataset.f) setFilter(e.target.dataset.f); });
$('clear').addEventListener('click', () => window.lumen.clipClear());

function setFilter(f) {
  filter = f; sel = 0;
  $('tabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.f === f));
  render();
}

window.lumen.on('clips', (c) => { all = c; render(); });
window.lumen.on('clip-open', () => {
  $('q').value = ''; sel = 0; $('q').focus();
  const p = $('panel'); p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop');
  render();
});
App.init(async () => { all = await window.lumen.clips(); render(); });
