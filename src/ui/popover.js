const panel = document.getElementById('panel');
  const box = document.getElementById('box');
  const { esc } = App;
  let data = null;

  function render() {
    if (!data) return;
    if (data.mode === 'previews') {
      panel.innerHTML = `<div class="previews">${data.items.map(w => `
        <div class="pv" data-hwnd="${w.hwnd}">
          <div class="thumb" style="${w.thumb ? `background-image:url('${w.thumb}')` : ''}">${w.thumb ? '' : esc(w.min ? t('pop.minimized') : t('pop.noPreview'))}</div>
          <div class="title">${esc(w.title)}</div>
          <div class="close" data-close="${w.hwnd}" title="${esc(t('pop.close'))}">${App.icon('x')}</div>
        </div>`).join('')}</div>`;
    } else {
      panel.innerHTML = `
        <div class="stack-head"><b>${esc(data.title)}</b><a data-open="${esc(data.folder)}">${esc(t('pop.openFolder'))} →</a></div>
        ${data.items.length ? `<div class="grid">${data.items.map(f => `
          <div class="fi" data-open="${esc(f.path)}" title="${esc(f.name)}">
            ${f.icon ? `<img src="${f.icon}">` : App.icon(f.dir ? 'folder' : 'file')}
            <span>${esc(f.name)}</span>
          </div>`).join('')}</div>` : `<div class="empty">${esc(t('pop.empty'))}</div>`}`;
    }
    panel.classList.remove('pop'); void panel.offsetWidth; panel.classList.add('pop');
    requestAnimationFrame(() => {
      const r = box.getBoundingClientRect();
      window.lumen.popoverSize(Math.ceil(r.width) + 24, Math.ceil(r.height) + 24);
    });
  }

  panel.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { e.stopPropagation(); return window.lumen.popoverCloseWin(Number(c.dataset.close)); }
    const pv = e.target.closest('[data-hwnd]');
    if (pv) return window.lumen.popoverFocus(Number(pv.dataset.hwnd));
    const o = e.target.closest('[data-open]');
    if (o) window.lumen.popoverOpen(o.dataset.open);
  });
  document.addEventListener('mouseenter', () => window.lumen.popoverHover(true));
  document.addEventListener('mouseleave', () => window.lumen.popoverHover(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close && window.lumen.popoverHover(false); });

  window.lumen.on('popover', (d) => { data = d; render(); });
  App.init(() => render());
