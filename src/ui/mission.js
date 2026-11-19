const $ = (id) => document.getElementById(id);
const { esc } = App;
$('sico').innerHTML = window.ICONS.search;
let data = { items: [], desktops: null }, shown = [], sel = 0;

function render() {
  const d = data.desktops;
  $('desks').innerHTML = d ? d.ids.map((id, i) => `<div class="desk ${i === d.index ? 'on' : ''}" data-desk="${i}">${esc(t('mc.desktop', { n: i + 1 }))}</div>`).join('') +
    `<div class="desk add" data-new title="${esc(t('desk.new'))}">+</div>` : '';
  const q = $('q').value.trim().toLowerCase();
  shown = data.items.filter(w => !q || (w.title + ' ' + w.app).toLowerCase().includes(q));
  sel = Math.min(sel, Math.max(0, shown.length - 1));
  $('grid').innerHTML = shown.length ? shown.map((w, i) => `
    <div class="win ${i === sel ? 'sel' : ''}" data-i="${i}" style="animation-delay:${Math.min(i, 12) * 18}ms">
      <div class="shot" style="${w.thumb ? `background-image:url('${w.thumb}')` : ''}">${w.thumb ? '' : (w.icon ? `<img class="big" src="${w.icon}">` : '')}
        <div class="x" data-close="${w.hwnd}" title="${esc(t('pop.close'))}">${App.icon('x')}</div></div>
      <div class="meta">${w.icon ? `<img src="${w.icon}">` : ''}<span class="app">${esc(w.app)}</span><span class="ttl">${esc(w.title)}</span></div>
    </div>`).join('') : `<div class="empty">${esc(t('mc.empty'))}</div>`;
}

document.addEventListener('click', (e) => {
  const x = e.target.closest('[data-close]');
  if (x) { e.stopPropagation(); const h = Number(x.dataset.close); window.lumen.missionCloseWin(h); data.items = data.items.filter(w => w.hwnd !== h); return render(); }
  const w = e.target.closest('.win');
  if (w) return window.lumen.missionFocus(shown[Number(w.dataset.i)].hwnd);
  const d = e.target.closest('[data-desk]');
  if (d) return window.lumen.missionDesktop(Number(d.dataset.desk));
  if (e.target.closest('[data-new]')) return window.lumen.missionNewDesktop();
  if (!e.target.closest('.search')) window.lumen.missionHide();
});
document.addEventListener('keydown', (e) => {
  const cols = Math.max(1, Math.floor(($('grid').clientWidth - 120) / 326));
  if (e.key === 'Escape') window.lumen.missionHide();
  else if (e.key === 'Enter' && shown[sel]) window.lumen.missionFocus(shown[sel].hwnd);
  else if (e.key === 'ArrowRight') { sel = Math.min(shown.length - 1, sel + 1); render(); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + cols); render(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - cols); render(); e.preventDefault(); }
});
$('q').addEventListener('input', () => { sel = 0; render(); });

window.lumen.on('mission', (d) => { data = d; sel = 0; $('q').value = ''; $('q').focus(); render(); });
App.init(() => render());
