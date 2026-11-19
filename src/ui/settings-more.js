// Impostazioni: Profili e OBS, Strumenti, Snippet, sfondo per desktop virtuale.
(function () {
  const $ = (id) => document.getElementById(id);
  const { esc } = App;
  const set = (p) => window.lumen.update(p);
  let S = {};

  // ---------- Profili ----------
  const PROFILES = [['work', 'layout'], ['game', 'play'], ['battery', 'power'], ['live', 'screenshot']];
  function renderProfiles() {
    $('profileList').innerHTML = PROFILES.map(([id, ic]) => `
      <div class="row"><span style="display:flex;gap:12px;align-items:center">${App.icon(ic)}<span><span>${esc(t('prof.' + id))}</span><span class="hint">${esc(t('prof.' + id + 'Hint'))}</span></span></span>
        <button class="btn ${S.activeProfile === id ? 'primary' : ''}" data-prof="${id}">${esc(t(S.activeProfile === id ? 'prof.active' : 'prof.apply'))}</button></div>`).join('') +
      (S.activeProfile ? `<div class="row"><span class="hint">${esc(t('prof.restoreHint'))}</span><button class="btn" data-prof="">${esc(t('perf.restore'))}</button></div>` : '');
  }
  $('profileList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-prof]'); if (!b) return;
    b.disabled = true; await window.lumen.profileApply(b.dataset.prof || null); b.disabled = false;
  });

  function renderLiveApps() {
    const list = S.liveApps || [];
    $('liveApps').innerHTML = list.length ? list.map((p, i) => `<div class="row"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.split('\\').pop().replace(/\.(lnk|exe)$/i, ''))}<span class="hint">${esc(p)}</span></span><button class="icon-btn" data-rmlive="${i}">${App.icon('trash')}</button></div>`).join('')
      : `<div class="row hint">${esc(t('s.liveAuto'))}</div>`;
  }
  $('liveApps').addEventListener('click', (e) => { const b = e.target.closest('[data-rmlive]'); if (b) set({ liveApps: S.liveApps.filter((_, i) => i !== Number(b.dataset.rmlive)) }); });
  $('addLiveApp').onclick = async () => { const a = await window.AppPicker.openAppPicker(new Set(S.liveApps || [])); if (a && a.length) set({ liveApps: [...(S.liveApps || []), ...a.map(x => x.path)] }); };
  $('addLiveFile').onclick = async () => { const a = await window.lumen.pickApps(); if (a && a.length) set({ liveApps: [...(S.liveApps || []), ...a.map(x => x.path)] }); };

  // OBS: la password non viene mai riscritta nel campo (solo salvata quando la cambi)
  let pwT;
  $('obsPassword').addEventListener('input', (e) => { clearTimeout(pwT); pwT = setTimeout(() => set({ obsPassword: e.target.value }), 500); });
  $('obsTest').onclick = async () => {
    $('obsTestRes').textContent = '…';
    const s = await window.lumen.obsStatus();
    $('obsTestRes').textContent = !s.enabled ? t('obs.disabled') : s.connected ? t('obs.connected', { s: s.scene || '' }) : t(s.error === 'password' ? 'obs.password' : 'obs.offline');
    $('obsTestRes').className = 'hint ' + (s.connected ? 'ok' : 'warn');
  };

  // ---------- Strumenti ----------
  $('pickNow').onclick = () => window.lumen.pickerStart();
  function renderColors() {
    const cols = S.colors || [];
    $('recentColors').innerHTML = cols.length ? cols.map(c => `<button title="${c}" data-col="${c}" style="background:${c}"></button>`).join('') : `<span class="hint">—</span>`;
  }
  $('recentColors').addEventListener('click', (e) => { const b = e.target.closest('[data-col]'); if (b) { navigator.clipboard.writeText(b.dataset.col); b.title = '✓ ' + b.dataset.col; } });

  // Rinomina in blocco
  let rnFiles = [];
  function newName(f, i) {
    const dot = f.name.lastIndexOf('.');
    const base = dot > 0 ? f.name.slice(0, dot) : f.name, ext = dot > 0 ? f.name.slice(dot + 1) : '';
    let name = base;
    const find = $('rnFind').value;
    if (find) name = name.split(find).join($('rnRepl').value);
    const n = (Number($('rnStart').value) || 0) + i;
    const width = String((Number($('rnStart').value) || 0) + rnFiles.length - 1).length;
    let out = ($('rnPattern').value || '{name}').split('{name}').join(name).split('{n}').join(String(n).padStart(Math.max(2, width), '0'))
      .split('{date}').join(new Date().toISOString().slice(0, 10)).split('{ext}').join(ext);
    if (ext && !($('rnPattern').value || '').includes('{ext}')) out += '.' + ext;
    return out.trim();
  }
  function renderRename() {
    if (!rnFiles.length) { $('rnPreview').innerHTML = ''; $('rnApply').disabled = true; return; }
    $('rnApply').disabled = false;
    $('rnPreview').innerHTML = rnFiles.slice(0, 50).map((f, i) => `<div class="row" style="min-height:34px;padding:6px 16px;font-size:12.5px"><span style="opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span><span>→ <b>${esc(newName(f, i))}</b></span></div>`).join('') +
      (rnFiles.length > 50 ? `<div class="row hint">+${rnFiles.length - 50}</div>` : '');
  }
  ['rnPattern', 'rnFind', 'rnRepl', 'rnStart'].forEach(id => $(id).addEventListener('input', renderRename));
  $('rnPick').onclick = async () => { rnFiles = await window.lumen.toolsPick('any'); $('rnStatus').textContent = rnFiles.length ? t('s.filesPicked', { n: rnFiles.length }) : ''; renderRename(); };
  $('rnApply').onclick = async () => {
    const ops = rnFiles.map((f, i) => ({ from: f.path, to: newName(f, i) }));
    const r = await window.lumen.toolsRename(ops);
    $('rnStatus').textContent = t('s.renamed', { n: r.done }) + (r.errors.length ? ' · ' + t('s.renameErrors', { n: r.errors.length }) : '');
    $('rnUndo').classList.toggle('hidden', !r.done);
    rnFiles = []; renderRename();
  };
  $('rnUndo').onclick = async () => { const n = await window.lumen.toolsRenameUndo(); $('rnStatus').textContent = t('s.undone', { n }); $('rnUndo').classList.add('hidden'); };

  // Conversione immagini (canvas nel renderer, salvataggio fatto dal processo principale)
  let cvFormat = 'jpg';
  $('cvFormat').addEventListener('click', (e) => { const v = e.target.dataset.v; if (!v) return; cvFormat = v; $('cvFormat').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); });
  $('cvQuality').addEventListener('input', (e) => { $('cvQualityV').textContent = Math.round(e.target.value * 100) + '%'; });
  const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
  $('cvPick').onclick = async () => {
    const files = await window.lumen.toolsPick('images');
    if (!files.length) return;
    const maxW = Number($('cvWidth').value) || 0, q = Number($('cvQuality').value);
    const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[cvFormat];
    let ok = 0, last = null;
    for (const [i, f] of files.entries()) {
      $('cvStatus').textContent = t('s.converting', { i: i + 1, n: files.length });
      try {
        const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = fileUrl(f.path); });
        const scale = maxW && img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
        const g = cv.getContext('2d');
        if (cvFormat === 'jpg') { g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); }
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, cv.width, cv.height);
        const blob = await new Promise(r => cv.toBlob(r, mime, q));
        last = await window.lumen.toolsConvertSave(f.path, cvFormat, new Uint8Array(await blob.arrayBuffer()));
        if (last) ok++;
      } catch {}
    }
    $('cvStatus').innerHTML = esc(t('s.converted', { n: ok })) + (last ? ` · <a id="cvShow" style="color:var(--accent)">${esc(t('dock.showInFolder'))}</a>` : '');
    if (last) $('cvShow').onclick = () => window.lumen.toolsReveal(last);
  };

  // ---------- Snippet ----------
  let snips = [];
  function renderSnips() {
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#snipList')) return;
    snips = (S.snippets || []).map(x => ({ ...x }));
    $('snipList').innerHTML = snips.length ? snips.map((s, i) => `
      <div class="row" style="align-items:flex-start"><input type="text" data-sn="${i}" data-f="trigger" value="${esc(s.trigger)}" style="width:120px" placeholder=";sigla">
        <textarea data-sn="${i}" data-f="text" rows="2" style="all:unset;flex:1;background:var(--field);border-radius:7px;padding:6px 10px;box-shadow:inset 0 0 0 1px var(--line);font-size:13px;white-space:pre-wrap;min-height:20px" placeholder="${esc(t('s.snipText'))}">${esc(s.text)}</textarea>
        <button class="icon-btn" data-rmsn="${i}">${App.icon('trash')}</button></div>`).join('')
      : `<div class="row hint">${esc(t('s.snipNone'))}</div>`;
  }
  let snT;
  $('snipList').addEventListener('input', (e) => {
    const i = e.target.dataset.sn; if (i === undefined) return;
    snips[i][e.target.dataset.f] = e.target.value;
    clearTimeout(snT); snT = setTimeout(() => set({ snippets: snips }), 600);
  });
  $('snipList').addEventListener('click', (e) => { const b = e.target.closest('[data-rmsn]'); if (b) { snips.splice(Number(b.dataset.rmsn), 1); set({ snippets: snips }); } });
  $('snipAdd').onclick = () => { set({ snippets: [...(S.snippets || []), { trigger: ';', text: '' }] }); };

  // ---------- Sfondo per desktop virtuale ----------
  async function renderDeskWp() {
    const d = await window.lumen.desktopsGet();
    const ids = (d && d.ids) || [];
    const map = S.desktopWallpapers || {};
    const url = (p) => `url("${fileUrl(p)}")`;
    $('deskWp').innerHTML = ids.length > 1 ? `<div class="wp-grid">${ids.map((id, i) => `<div class="wp" data-desk="${id}"><div class="img" style="${map[id] ? `background-image:${url(map[id])}` : ''}">${map[id] ? '' : '+'}</div>${esc(t('mc.desktop', { n: i + 1 }))}${map[id] ? ` · <a data-clear="${id}" style="color:var(--accent)">${esc(t('s.remove'))}</a>` : ''}</div>`).join('')}</div>`
      : `<div class="row hint">${esc(t('s.deskWpHint'))}</div>`;
  }
  $('deskWp').addEventListener('click', async (e) => {
    const cl = e.target.closest('[data-clear]');
    if (cl) { e.stopPropagation(); return set({ desktopWallpapers: { [cl.dataset.clear]: '' } }); }
    const el = e.target.closest('[data-desk]'); if (!el) return;
    const p = await window.lumen.pickImage(); if (p) set({ desktopWallpapers: { [el.dataset.desk]: p } });
  });

  // ---------- Sincronizzazione ----------
  function sync(s) {
    S = s;
    renderProfiles(); renderLiveApps(); renderColors(); renderSnips(); renderDeskWp(); renderRename();
  }
  window.lumen.getSettings().then(sync);
  window.lumen.on('settings', (s) => setTimeout(() => sync(s), 0));
})();
