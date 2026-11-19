const $ = (id) => document.getElementById(id);
const { esc } = App;
let items = [], idx = 0;
const url = (p) => 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
const size = (b) => b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + ' GB' : b >= 1024 ** 2 ? (b / 1024 ** 2).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';

function show() {
  const it = items[idx]; if (!it) return;
  $('ico').src = it.icon || ''; $('ico').style.visibility = it.icon ? 'visible' : 'hidden';
  $('name').textContent = it.name;
  $('nav').textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';
  const date = new Date(it.mtime).toLocaleString(App.S.lang === 'en' ? 'en-GB' : 'it-IT', { dateStyle: 'medium', timeStyle: 'short' });
  $('meta').textContent = (it.kind === 'folder' ? t('ql.items', { n: it.count ?? 0 }) : size(it.size)) + ' · ' + date;
  const v = $('view');
  switch (it.kind) {
    case 'image': v.innerHTML = `<img class="full" src="${url(it.path)}">`; break;
    case 'video': v.innerHTML = `<video src="${url(it.path)}" controls autoplay></video>`; break;
    case 'audio': v.innerHTML = `<div class="other"><img src="${it.icon || ''}"><b>${esc(it.name)}</b><audio src="${url(it.path)}" controls autoplay></audio></div>`; break;
    case 'pdf': v.innerHTML = `<iframe src="${url(it.path)}"></iframe>`; break;
    case 'text': v.innerHTML = `<pre>${esc(it.text)}${it.truncated ? '\n\n… ' + esc(t('ql.truncated')) : ''}</pre>`; break;
    case 'folder': v.innerHTML = `<div class="folder">${(it.entries || []).map(n => `<div>${esc(n)}</div>`).join('')}</div>`; break;
    default: v.innerHTML = `<div class="other"><img src="${it.icon || ''}"><b>${esc(it.name)}</b><span>${esc(t('ql.noPreview'))}</span></div>`;
  }
}

$('open').onclick = () => window.lumen.qlOpen(items[idx].path);
$('reveal').onclick = () => window.lumen.qlReveal(items[idx].path);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || (e.key === ' ' && document.activeElement.tagName !== 'VIDEO')) { stopMedia(); window.lumen.qlHide(); e.preventDefault(); }
  else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && idx < items.length - 1) { idx++; show(); }
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && idx > 0) { idx--; show(); }
  else if (e.key === 'Enter') window.lumen.qlOpen(items[idx].path);
});
function stopMedia() { document.querySelectorAll('video, audio').forEach(m => m.pause()); }
window.addEventListener('blur', stopMedia);

window.lumen.on('ql', (list) => { items = list; idx = 0; const p = $('panel'); p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); show(); });
App.init(() => {});
