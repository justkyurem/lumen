// Sezione Prestazioni: pulizia in un clic, interruttori di Windows, app all'avvio, processi pesanti.
(function () {
  const $ = (id) => document.getElementById(id);
  const { esc } = App;
  const mb = (b) => (b / 1024 ** 3 >= 1 ? (b / 1024 ** 3).toFixed(1) + ' GB' : Math.max(0, Math.round(b / 1024 / 1024)) + ' MB');
  let perf = null;

  async function refresh() {
    refreshBackup();
    window.lumen.perfState().then(p => { perf = p; renderToggles(); });
    window.lumen.perfTemp().then(r => { $('tempHint').textContent = t('perf.tempHint', { s: mb(r.bytes), n: r.count }); });
    loadStartup();
    loadProcs();
  }

  async function refreshBackup() {
    const b = await window.lumen.perfBackup();
    $('restoreBox').classList.toggle('hidden', !b);
    if (b) $('restoreHint').textContent = t('perf.restoreHint', { d: new Date(b.at).toLocaleString(App.S.lang === 'en' ? 'en-GB' : 'it-IT', { dateStyle: 'medium', timeStyle: 'short' }) });
  }

  function renderToggles() {
    document.querySelectorAll('[data-perf]').forEach(el => {
      const k = el.dataset.perf;
      el.checked = k === 'liteMode' ? !!App.S.liteMode : !!(perf && perf[k]);
      el.disabled = k !== 'liteMode' && !perf;
    });
    const sel = $('powerPlan');
    const plans = (perf && perf.power && perf.power.list) || [];
    sel.innerHTML = plans.map(p => `<option value="${p.id}" ${p.id === perf.power.active ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    sel.disabled = !plans.length;
  }

  document.querySelectorAll('[data-perf]').forEach(el => el.addEventListener('change', async () => {
    await window.lumen.perfSet(el.dataset.perf, el.checked);
    refreshBackup();
  }));
  $('powerPlan').addEventListener('change', async (e) => { await window.lumen.perfSet('power', e.target.value); refreshBackup(); });

  $('cleanTemp').onclick = async () => {
    const btn = $('cleanTemp'); btn.disabled = true;
    const r = await window.lumen.tempClean();
    btn.disabled = false;
    if (r) $('tempHint').textContent = t('perf.freed', { s: mb(r.bytes), n: r.count });
  };

  // --- App all'avvio ---
  let startup = [];
  async function loadStartup() {
    startup = await window.lumen.perfStartup();
    $('startupList').innerHTML = startup.length ? startup.map((e, i) => `
      <div class="row"><span style="min-width:0"><span>${esc(e.name)}</span>${e.editable ? '' : `<span class="tag">${esc(t('perf.admin'))}</span>`}
        <span class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px">${esc(e.command)}</span></span>
        <label class="sw"><input type="checkbox" data-st="${i}" ${e.enabled ? 'checked' : ''} ${e.editable ? '' : 'disabled'}><span></span></label></div>`).join('')
      : `<div class="row hint">${esc(t('perf.noStartup'))}</div>`;
  }
  $('startupList').addEventListener('change', async (e) => {
    const i = e.target.dataset.st; if (i === undefined) return;
    await window.lumen.startupSet({ name: startup[i].name, kind: startup[i].kind }, e.target.checked);
    refreshBackup();
  });

  // --- Processi pesanti ---
  let procs = [];
  async function loadProcs() {
    procs = await window.lumen.perfProcs();
    $('procList').innerHTML = procs.length ? procs.map((p, i) => `
      <div class="row"><span>${esc(p.label)}${p.count > 1 ? `<span class="tag">${p.count} ${esc(t('perf.processes'))}</span>` : ''}</span>
        <div class="ctrl"><span class="proc-mem">~${mb(p.mem)}</span><button class="btn" data-kill="${i}">${esc(t('perf.kill'))}</button></div></div>`).join('')
      : `<div class="row hint">—</div>`;
  }
  $('procList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-kill]'); if (!b) return;
    if (await window.lumen.procKill(procs[b.dataset.kill])) setTimeout(loadProcs, 800);
  });
  $('procsRefresh').onclick = loadProcs;

  $('restore').onclick = async () => {
    $('restore').disabled = true;
    await window.lumen.perfRestore();
    $('restore').disabled = false;
    refresh();
  };

  $('openDisk').onclick = () => window.lumen.disk.openWindow();

  // --- Pulizia in un clic ---
  $('oneClick').onclick = openOneClick;

  async function openOneClick() {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" style="width:560px">
      <header><b style="font-size:15px">${esc(t('perf.oneTitle'))}</b></header>
      <div class="body" id="ocBody"><div style="padding:30px 0;text-align:center"><span class="spin"></span>${esc(t('perf.scanning'))}</div></div>
      <footer><span class="hint" id="ocNote"></span><div class="btns"><button class="btn" data-x="cancel">${esc(t('common.cancel'))}</button><button class="btn primary" data-x="run" disabled>${esc(t('perf.run'))}</button></div></footer>
    </div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    bg.querySelector('[data-x=cancel]').onclick = close;

    const scan = await window.lumen.oneClickScan();
    const body = bg.querySelector('#ocBody');
    const tag = (rev) => `<span class="tag ${rev ? 'rev' : 'perm'}">${esc(t(rev ? 'perf.reversible' : 'perf.permanentShort'))}</span>`;
    body.innerHTML = `
      <div class="ck"><input type="checkbox" id="ocTemp" ${scan.temp.bytes > 0 ? 'checked' : 'disabled'}><div class="d">${esc(t('perf.ocTemp', { s: mb(scan.temp.bytes) }))}${tag(false)}<small>${esc(t('perf.ocTempHint', { n: scan.temp.count }))}</small></div></div>
      <div class="ck"><input type="checkbox" id="ocRecycle" ${scan.recycle > 0 ? 'checked' : 'disabled'}><div class="d">${esc(t('perf.ocRecycle', { n: scan.recycle }))}${tag(false)}</div></div>
      <div class="ck"><input type="checkbox" id="ocStartup" ${scan.startup.length ? 'checked' : 'disabled'}><div class="d">${esc(t('perf.ocStartup', { n: scan.startup.length }))}${tag(true)}<small>${esc(t('perf.ocStartupHint'))}</small>
        <div class="sub-list">${scan.startup.map((s, i) => `<label><input type="checkbox" data-sti="${i}" checked>${esc(s.name)}</label>`).join('')}</div></div></div>
      <div class="ck"><input type="checkbox" id="ocBloat" ${scan.bloat.length ? 'checked' : 'disabled'}><div class="d">${esc(t('perf.ocBloat', { n: scan.bloat.length }))}<span class="tag">${esc(t('perf.store'))}</span><small>${esc(t('perf.ocBloatHint'))}</small>
        <div class="sub-list">${scan.bloat.map((b, i) => `<label><input type="checkbox" data-bi="${i}" checked>${esc(b.label)}</label>`).join('')}</div></div></div>
      <div class="ck"><input type="checkbox" id="ocTweaks" checked><div class="d">${esc(t('perf.ocTweaks'))}${tag(true)}<small>${esc(t(scan.highPlan ? 'perf.ocTweaksHint' : 'perf.ocTweaksHintNoPlan'))}</small></div></div>`;
    bg.querySelector('#ocNote').textContent = t('perf.ocNote');
    const run = bg.querySelector('[data-x=run]');
    run.disabled = false;

    run.onclick = async () => {
      const on = (id) => body.querySelector('#' + id).checked;
      const choice = {
        temp: on('ocTemp'), recycle: on('ocRecycle'), tweaks: on('ocTweaks'), highPlan: scan.highPlan,
        startup: on('ocStartup') ? scan.startup.filter((s, i) => body.querySelector(`[data-sti="${i}"]`).checked).map(s => ({ name: s.name, kind: s.kind })) : [],
        bloat: on('ocBloat') ? scan.bloat.filter((b, i) => body.querySelector(`[data-bi="${i}"]`).checked).map(b => b.id) : [],
      };
      run.disabled = true; bg.querySelector('[data-x=cancel]').disabled = true;
      body.innerHTML = `<div style="padding:30px 0;text-align:center"><span class="spin"></span>${esc(t('perf.working'))}</div>`;
      const r = await window.lumen.oneClickRun(choice);
      const lines = [];
      if (choice.temp) lines.push(t('perf.doneTemp', { s: r.freedText, n: r.files }));
      if (r.recycle) lines.push(t('perf.doneRecycle'));
      if (r.startup) lines.push(t('perf.doneStartup', { n: r.startup }));
      if (r.bloat.length) lines.push(t('perf.doneBloat', { n: r.bloat.length }));
      if (r.tweaks.length) lines.push(t('perf.doneTweaks'));
      body.innerHTML = `<div style="padding:16px 0 6px"><b style="font-size:16px">✓ ${esc(t('perf.done'))}</b>
        <ul style="margin:12px 0 0 18px;line-height:1.9">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        <p class="hint" style="margin-top:12px">${esc(t('perf.doneNote'))}</p></div>`;
      bg.querySelector('#ocNote').textContent = '';
      bg.querySelector('footer .btns').innerHTML = `<button class="btn primary">${esc(t('perf.close'))}</button>`;
      bg.querySelector('footer .btn').onclick = () => { close(); refresh(); };
    };
  }

  window.Perf = { refresh };
})();
