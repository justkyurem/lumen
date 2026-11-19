const dock = document.getElementById('dock');
let S = {}, icons = {}, inside = false, hideTimer = null;
let dstate = { running: [], unpinned: [], recycle: 0 };
let hovered = null;
const { esc } = App;

function tile(a) {
  if (a.type === 'folder') return `<div class="tile folder">${App.icon('folder')}</div>`;
  if (a.icon && icons[a.id]) return `<div class="tile custom"><img src="${icons[a.id]}"></div>`;
  if (icons[a.id]) return `<div class="tile"><img src="${icons[a.id]}"></div>`;
  if (a.glyph) return `<div class="tile">${App.icon(a.glyph)}</div>`;
  return `<div class="tile"><span class="letter">${esc((a.name || '?')[0].toUpperCase())}</span></div>`;
}

function render() {
  document.documentElement.style.setProperty('--s', S.dockSize + 'px');
  const running = new Set(S.dockShowRunning ? dstate.running : []);
  let html = S.apps.map(a => `
    <div class="item ${running.has(a.id) ? 'running' : ''}" data-kind="pinned" data-key="${a.id}">
      ${tile(a)}<span class="dot"></span><span class="label">${esc(a.name)}</span>
    </div>`).join('');
  if (S.dockShowUnpinned && dstate.unpinned.length) {
    html += '<div class="sep"></div>' + dstate.unpinned.map(u => `
      <div class="item running" data-kind="unpinned" data-key="${esc(u.key)}">
        <div class="tile">${u.icon ? `<img src="${u.icon}">` : `<span class="letter">${esc((u.name || '?')[0])}</span>`}</div>
        <span class="dot"></span><span class="label">${esc(u.name)}</span>
      </div>`).join('');
  }
  html += '<div class="sep"></div>';
  html += `<div class="item" data-kind="lumen"><div class="tile">${App.icon('grid')}</div><span class="label">${esc(t('dock.customize'))}</span></div>`;
  if (S.dockShowTrash) {
    html += `<div class="item" data-kind="trash"><div class="tile">${App.icon(dstate.recycle ? 'trashFull' : 'trash')}</div>
      <span class="label">${esc(t('dock.trash'))}${dstate.recycle ? ' · ' + dstate.recycle : ''}</span></div>`;
  }
  dock.innerHTML = html;
  applyHidden();
}

// --- Ingrandimento stile macOS ---
function magnify(mx) {
  const base = S.dockSize, max = S.dockMagnify ? S.dockMagnifyScale : 1, range = base * 2.6;
  dock.querySelectorAll('.item').forEach(el => {
    let scale = 1;
    if (mx != null && max > 1) {
      const r = el.getBoundingClientRect();
      const d = Math.abs(mx - (r.left + r.width / 2));
      if (d < range) scale = 1 + (max - 1) * Math.cos((d / range) * Math.PI / 2) ** 2;
    }
    const px = Math.round(base * scale) + 'px';
    el.style.width = px; el.style.height = px;
  });
}

function applyHidden() { dock.classList.toggle('hidden-dock', !!S.dockAutoHide && !inside); }

function rectOf(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }

document.addEventListener('mousemove', (e) => {
  const r = dock.getBoundingClientRect();
  const overDock = !dock.classList.contains('hidden-dock') &&
    e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 8 && e.clientY <= window.innerHeight;
  const hotZone = S.dockAutoHide && e.clientY >= window.innerHeight - 4;
  const now = overDock || hotZone;
  if (now !== inside) {
    inside = now;
    window.lumen.dockMouse(inside);
    clearTimeout(hideTimer);
    if (inside) applyHidden(); else hideTimer = setTimeout(applyHidden, 450);
  }
  magnify(overDock ? e.clientX : null);

  const it = overDock ? document.elementFromPoint(e.clientX, e.clientY)?.closest('.item') : null;
  const key = it ? it.dataset.kind + ':' + (it.dataset.key || '') : null;
  if (key !== hovered) {
    hovered = key;
    if (it) setTimeout(() => window.lumen.dockHover(it.dataset.kind, it.dataset.key || null, rectOf(it)), 130);
    else window.lumen.dockHover(null, null, null);
  }
});

document.addEventListener('mouseleave', () => {
  inside = false; window.lumen.dockMouse(false); magnify(null);
  hovered = null; window.lumen.dockHover(null, null, null);
  clearTimeout(hideTimer); hideTimer = setTimeout(applyHidden, 450);
});

dock.addEventListener('click', (e) => {
  const it = e.target.closest('.item'); if (!it) return;
  const { kind, key } = it.dataset;
  if (kind === 'pinned' && !it.classList.contains('running')) {
    const a = S.apps.find(x => x.id === key);
    if (a && a.type !== 'folder') {
      it.classList.remove('bounce'); void it.offsetWidth; it.classList.add('bounce');
      setTimeout(() => it.classList.remove('bounce'), 1400);
    }
  }
  window.lumen.dockClick(kind, key || null, rectOf(it));
});

dock.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const it = e.target.closest('.item');
  window.lumen.dockContext(it ? it.dataset.kind : null, it ? it.dataset.key || null : null);
});

window.lumen.on('running', (d) => { dstate = { ...dstate, ...d }; render(); });
window.lumen.on('recycle', (n) => { dstate.recycle = n; render(); });

App.init(async (s) => {
  S = s;
  icons = await window.lumen.dockIcons();
  dstate = await window.lumen.dockState();
  render();
});
