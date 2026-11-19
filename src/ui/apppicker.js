// Elenco delle app installate con ricerca e selezione multipla.
// renderAppList(container, apps, selected:Set<path>, onToggle) disegna la lista; openAppPicker() la mostra in un modale.
(function () {
  const { esc } = App;
  const iconCache = new Map();

  function renderAppList(container, apps, selected, onToggle, filter = '') {
    const q = filter.trim().toLowerCase();
    const list = apps.filter(a => !q || a.name.toLowerCase().includes(q)).slice(0, 300);
    container.innerHTML = list.map((a, i) => `
      <div class="pick ${selected.has(a.path) ? 'on' : ''}" data-i="${i}">
        <img data-src="${esc(a.iconSrc || a.path)}" class="hidden"><span class="letter">${esc(a.name[0] || '?')}</span>
        <span>${esc(a.name)}</span><i class="check">${window.ICONS.check}</i>
      </div>`).join('') || `<div class="hint" style="padding:20px">${esc(t('picker.none'))}</div>`;
    container.onclick = (e) => {
      const r = e.target.closest('.pick'); if (!r) return;
      const a = list[Number(r.dataset.i)];
      if (selected.has(a.path)) selected.delete(a.path); else selected.add(a.path);
      r.classList.toggle('on', selected.has(a.path));
      onToggle && onToggle(a, selected.has(a.path));
    };
    // Icone caricate solo quando visibili
    const io = new IntersectionObserver((ents) => {
      for (const en of ents) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        const img = en.target, src = img.dataset.src;
        const set = (url) => { if (url) { img.src = url; img.classList.remove('hidden'); img.nextElementSibling.classList.add('hidden'); } };
        if (iconCache.has(src)) set(iconCache.get(src));
        else window.lumen.icon(src).then(u => { iconCache.set(src, u); set(u); });
      }
    }, { root: container });
    container.querySelectorAll('img[data-src]').forEach(i => io.observe(i));
  }

  async function openAppPicker(alreadyPaths) {
    const apps = await window.lumen.installedApps();
    const selected = new Set();
    return new Promise((resolve) => {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = `<div class="modal">
        <header><input type="text" placeholder="${esc(t('picker.search'))}"></header>
        <div class="list"></div>
        <footer><span class="hint" id="pcount"></span><div class="btns"><button class="btn" data-x="cancel">${esc(t('common.cancel'))}</button><button class="btn primary" data-x="ok">${esc(t('picker.add'))}</button></div></footer>
      </div>`;
      document.body.appendChild(bg);
      const listEl = bg.querySelector('.list'), input = bg.querySelector('input');
      const avail = apps.filter(a => !alreadyPaths.has(a.path));
      const count = () => { bg.querySelector('#pcount').textContent = t('picker.selected', { n: selected.size }); };
      const draw = () => renderAppList(listEl, avail, selected, count, input.value);
      input.addEventListener('input', draw);
      draw(); count(); input.focus();
      const done = (ok) => { bg.remove(); resolve(ok ? avail.filter(a => selected.has(a.path)) : null); };
      bg.addEventListener('click', (e) => {
        if (e.target === bg) done(false);
        const x = e.target.closest('[data-x]');
        if (x) done(x.dataset.x === 'ok');
      });
      bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
    });
  }

  window.AppPicker = { renderAppList, openAppPicker };
})();
