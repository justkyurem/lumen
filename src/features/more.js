// Funzioni aggiuntive di Lumen: Mission Control, pannello laterale, desktop virtuali, profili, OBS,
// Quick Look, selettore colore, strumenti (rinomina/converti), snippet, ricerca nel browser,
// pulizia programmata e avvisi di sistema.
const { app, BrowserWindow, ipcMain, screen, shell, desktopCapturer, Notification, dialog, clipboard, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { OBS } = require('./obs');
const { BrowserSearch } = require('./browser');

const PLAN = { high: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', bal: '381b4222-f694-41f0-9685-ff5bb260df2e', saver: 'a1841308-3541-4fab-bc81-f71556f20b4a' };
const PROFILES = {
  work: { power: 'bal', animations: true, dnd: false, lite: false },
  game: { power: 'high', animations: false, dnd: true, lite: true },
  battery: { power: 'saver', animations: false, transparency: false, dnd: false, lite: true },
  live: { power: 'high', dnd: true, lite: true, live: true },
};

const EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'],
  pdf: ['pdf'],
  text: ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'htm', 'xml', 'yml', 'yaml', 'ini', 'cfg', 'conf', 'log', 'csv', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'ps1', 'bat', 'sql', 'toml', 'env', 'gitignore', 'srt', 'vtt', 'lua', 'kt', 'swift'],
};

exports.install = (c) => {
  const { W, fast, slow, hooks, send, sendBars, alive, t } = c;
  const S = () => c.S;
  const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a, e));
  const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => fn(...a, e));
  const icon = path.join(__dirname, '..', '..', 'build', 'icon.png');
  const notify = (title, body, onClick) => { const n = new Notification({ title, body, icon }); if (onClick) n.on('click', onClick); n.show(); };
  hooks.onPatch = hooks.onPatch || [];

  // ====================================================================
  // Mission Control
  // ====================================================================
  const descCache = new Map();
  const describe = async (exe) => { if (!descCache.has(exe)) descCache.set(exe, await fast.safe('describe', { exe }, path.basename(exe, '.exe'))); return descCache.get(exe); };

  async function mission() {
    const w = c.lazy('mission', 'mission.html', { width: 800, height: 600, focusable: true }, (w) => {
      // Ignora la perdita di focus nei primi istanti: Windows a volte la restituisce alla finestra precedente
      w.on('blur', () => { if (Date.now() - (w._shownAt || 0) > 600) w.hide(); else setTimeout(() => { if (w.isVisible()) w.focus(); }, 50); });
    });
    if (w.isVisible()) return w.hide();
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wins = (await fast.safe('windows', { exclude: process.pid }, []) || [])
      .filter(x => x.exe && !/\\(applicationframehost|textinputhost|shellexperiencehost|searchhost)\.exe$/i.test(x.exe));
    let sources = [];
    try { sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 520, height: 330 } }); } catch {}
    const thumbs = new Map(sources.map(s => [s.id, s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL()]));
    const items = [];
    for (const x of wins.slice(0, 24)) {
      items.push({ hwnd: x.hwnd, title: x.title, min: x.min, app: await describe(x.exe), icon: await c.apps.icon(x.exe), thumb: thumbs.get(`window:${x.hwnd}:0`) || null });
    }
    const desktops = await fast.safe('desktops', {}, null);
    w.setBounds(d.bounds);
    w._shownAt = Date.now();
    w.show(); w.moveTop(); w.focus();
    send(w, 'mission', { items, desktops });
  }
  hooks.mission = mission;
  const hideMission = () => { if (alive(W.mission)) W.mission.hide(); };
  on('mission-focus', (hwnd) => { hideMission(); fast.safe('focus', { hwnd }); });
  on('mission-close-win', (hwnd) => fast.safe('close', { hwnd }));
  on('mission-desktop', async (i) => { hideMission(); await fast.safe('switchDesktop', { index: i }, null, 8000); pollDesktops(); });
  on('mission-new-desktop', async () => { hideMission(); await fast.safe('newDesktop'); setTimeout(pollDesktops, 500); });
  on('mission-hide', hideMission);

  // ====================================================================
  // Pannello laterale (notifiche, calendario, meteo, musica)
  // ====================================================================
  function panel() {
    const w = c.lazy('panel', 'panel.html', { width: 380, height: 700, focusable: true }, (w) => { w.on('blur', () => w.hide()); });
    if (w.isVisible()) return w.hide();
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = d.workArea;
    w.setBounds({ x: wa.x + wa.width - 392, y: Math.max(wa.y, d.bounds.y + c.BAR_H) + 6, width: 386, height: wa.height - 12 - Math.max(0, d.bounds.y + c.BAR_H - wa.y) });
    w.show(); w.focus();
    send(w, 'panel-open', { weather: c.state.weather, pomo: c.state.pomo });
  }
  hooks.panel = panel;
  on('toggle-panel', () => panel());
  on('panel-win-notifications', () => { if (alive(W.panel)) W.panel.hide(); setTimeout(() => fast.safe('winNotifications'), 150); });
  handle('panel-media', () => slow.safe('media', {}, null, 4000));

  // ====================================================================
  // Desktop virtuali (+ sfondo per desktop)
  // ====================================================================
  let desks = null;
  async function pollDesktops() {
    const d = await fast.safe('desktops', {}, null, 3000);
    if (!d) return;
    const sig = d.ids.join() + '|' + d.current;
    if (desks && desks.sig === sig) return;
    const changedDesk = !desks || desks.current !== d.current;
    desks = { ...d, sig };
    sendBars('desktops', desks);
    const wp = S().desktopWallpapers && S().desktopWallpapers[d.current];
    if (changedDesk && wp && fs.existsSync(wp)) fast.safe('wallpaper', { path: wp });
  }
  setInterval(() => { if (S().showDesktops || Object.keys(S().desktopWallpapers || {}).length) pollDesktops(); }, 1500);
  fast.ready.then(pollDesktops);
  handle('desktops-get', () => desks);
  on('bar-desktop', (i) => fast.safe('switchDesktop', { index: i }, null, 8000).then(pollDesktops));
  on('bar-desktop-menu', (pos, e) => {
    Menu.buildFromTemplate([
      { label: t('desk.new'), click: () => fast.safe('newDesktop').then(() => setTimeout(pollDesktops, 500)) },
      { label: t('desk.close'), enabled: !!desks && desks.ids.length > 1, click: () => fast.safe('closeDesktop').then(() => setTimeout(pollDesktops, 500)) },
      { type: 'separator' },
      { label: t('cmd.mission'), click: mission },
      { label: t('desk.wallpapers'), click: () => c.openSettings('sfondo') },
    ]).popup({ window: BrowserWindow.fromWebContents(e.sender), x: pos.x, y: pos.y });
  });

  // ====================================================================
  // Profili
  // ====================================================================
  async function launchLiveApps() {
    let list = (S().liveApps || []).filter(Boolean);
    if (!list.length) {
      if (!c.apps.items.length) await c.apps.refresh();
      list = c.apps.items.filter(a => /^obs( studio)?/i.test(a.name) || /^discord$/i.test(a.name)).map(a => a.path);
    }
    for (const p of list) {
      const exe = /\.exe$/i.test(p) ? path.basename(p).toLowerCase() : null;
      if (exe && c.windowsForExe(exe).length) continue;
      c.launchPath(p);
    }
  }
  async function applyProfile(id) {
    if (!id) { await c.restorePerf(); return true; }
    const p = PROFILES[id];
    if (!p) return false;
    await c.ensureBackup();
    const perf = await slow.safe('perf', {}, null, 15000);
    const plans = ((perf && perf.power && perf.power.list) || []).map(x => x.id);
    if (plans.includes(PLAN[p.power])) await slow.safe('setPerf', { key: 'power', on: PLAN[p.power] }, null, 15000);
    for (const k of ['animations', 'transparency']) if (k in p) await slow.safe('setPerf', { key: k, on: p[k] }, null, 15000);
    await fast.safe('setDnd', { on: p.dnd });
    c.patch({ liteMode: p.lite, activeProfile: id });
    if (p.live) launchLiveApps();
    return true;
  }
  handle('profile-apply', (id) => applyProfile(id || null));

  // ====================================================================
  // OBS (obs-websocket)
  // ====================================================================
  const obs = new OBS(() => send(W.control, 'obs-changed'));
  let obsKey = '';
  handle('obs-status', async () => {
    const s = S();
    if (!s.obsEnabled) { obs.close(); return { enabled: false }; }
    const key = `${s.obsHost}:${s.obsPort}:${s.obsPassword}`;
    if (key !== obsKey) { obs.close(); obsKey = key; }
    await obs.connect({ host: s.obsHost, port: s.obsPort, password: s.obsPassword });
    return { enabled: true, ...(await obs.status()) };
  });
  handle('obs-action', async (action, arg) => {
    try {
      if (action === 'stream') await obs.request('ToggleStream');
      else if (action === 'record') await obs.request('ToggleRecord');
      else if (action === 'scene') await obs.request('SetCurrentProgramScene', { sceneName: String(arg) });
      return true;
    } catch { return false; }
  });

  // ====================================================================
  // Quick Look
  // ====================================================================
  function kindOf(p, isDir) {
    if (isDir) return 'folder';
    const ext = path.extname(p).slice(1).toLowerCase();
    for (const [k, list] of Object.entries(EXT)) if (list.includes(ext)) return k;
    return 'other';
  }
  async function describeFile(p) {
    let st; try { st = fs.statSync(p); } catch { return null; }
    const kind = kindOf(p, st.isDirectory());
    const info = { path: p, name: path.basename(p) || p, kind, size: st.size, mtime: st.mtimeMs, icon: await c.apps.icon(p) };
    if (kind === 'text' || (kind === 'other' && st.size < 512 * 1024)) {
      try {
        const buf = Buffer.alloc(Math.min(st.size, 200 * 1024));
        const fd = fs.openSync(p, 'r'); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
        if (kind === 'text' || !buf.includes(0)) { info.kind = 'text'; info.text = buf.toString('utf8'); info.truncated = st.size > buf.length; }
      } catch {}
    }
    if (kind === 'folder') {
      try { const all = fs.readdirSync(p); info.count = all.length; info.entries = all.slice(0, 60); } catch { info.entries = []; }
    }
    return info;
  }
  async function quickLook() {
    const fg = await fast.safe('foreground', {}, null);
    if (alive(W.ql) && W.ql.isVisible()) return W.ql.hide();
    let files = [];
    if (fg && /\\explorer\.exe$/i.test(fg.exe || '')) files = await slow.safe('explorerSel', { hwnd: fg.hwnd }, [], 6000) || [];
    if (!files.length) return notify(t('ql.title'), t('ql.select'));
    const items = (await Promise.all(files.slice(0, 50).map(describeFile))).filter(Boolean);
    const w = c.lazy('ql', 'quicklook.html', {
      width: 960, height: 660, focusable: true,
      webPreferences: { preload: c.PRELOAD, contextIsolation: true, plugins: true },
    }, (w) => { w.on('blur', () => w.hide()); });
    c.centerOn(w, 960, 660, 0.1);
    w.show(); w.focus();
    send(w, 'ql', items);
  }
  on('ql-open', (p) => { if (alive(W.ql)) W.ql.hide(); shell.openPath(p); });
  on('ql-reveal', (p) => { if (alive(W.ql)) W.ql.hide(); shell.showItemInFolder(p); });
  on('ql-hide', () => { if (alive(W.ql)) W.ql.hide(); });

  // ====================================================================
  // Selettore colore sullo schermo
  // ====================================================================
  let pickerWin = null;
  async function picker() {
    if (pickerWin && !pickerWin.isDestroyed()) return;
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    let srcs = [];
    try { srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size }); } catch {}
    const src = srcs.find(s => s.display_id === String(d.id)) || srcs[0];
    if (!src) return;
    const img = src.thumbnail.toDataURL();
    pickerWin = new BrowserWindow({
      ...d.bounds, frame: false, skipTaskbar: true, resizable: false, movable: false, show: false, backgroundColor: '#000000',
      webPreferences: { preload: c.PRELOAD, contextIsolation: true },
    });
    pickerWin.setAlwaysOnTop(true, 'screen-saver');
    pickerWin.loadFile(c.UI('picker.html'));
    pickerWin.webContents.once('did-finish-load', () => { send(pickerWin, 'picker-image', img); pickerWin.show(); pickerWin.focus(); });
    pickerWin.on('blur', () => { if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close(); });
    pickerWin.on('closed', () => { pickerWin = null; });
  }
  on('picker-done', async (hex) => {
    if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close();
    if (!hex) return;
    await clipboard.writeText(hex);
    c.patch({ colors: [hex, ...(S().colors || []).filter(x => x !== hex)].slice(0, 12) });
    notify(t('picker.copied', { c: hex }), t('picker.copiedBody'));
  });
  on('picker-start', () => setTimeout(picker, 250));

  // ====================================================================
  // Strumenti: rinomina in blocco e conversione immagini
  // ====================================================================
  let picked = new Set();
  handle('tools-pick', async (kind) => {
    const filters = kind === 'images' ? [{ name: t('common.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }] : [];
    const r = await dialog.showOpenDialog(W.settings, { properties: ['openFile', 'multiSelections'], filters });
    if (r.canceled) return [];
    r.filePaths.forEach(p => picked.add(p));
    return r.filePaths.map(p => ({ path: p, name: path.basename(p), dir: path.dirname(p) }));
  });
  let lastRename = [];
  handle('tools-rename', (ops) => {
    const done = [], errors = [];
    for (const { from, to } of ops || []) {
      try {
        if (!picked.has(from)) throw new Error('not picked');
        if (!to || /[\\/:*?"<>|]/.test(to) || to === '.' || to === '..') throw new Error('invalid name');
        const dest = path.join(path.dirname(from), to);
        if (dest === from) continue;
        if (fs.existsSync(dest)) throw new Error('exists');
        fs.renameSync(from, dest);
        picked.delete(from); picked.add(dest);
        done.push({ from, to: dest });
      } catch (e) { errors.push({ from, error: e.message }); }
    }
    lastRename = done;
    return { done: done.length, errors };
  });
  handle('tools-rename-undo', () => {
    let n = 0;
    for (const { from, to } of [...lastRename].reverse()) {
      try { if (!fs.existsSync(from)) { fs.renameSync(to, from); picked.delete(to); picked.add(from); n++; } } catch {}
    }
    lastRename = [];
    return n;
  });
  handle('tools-convert-save', (input, ext, bytes) => {
    if (!picked.has(input) || !['png', 'jpg', 'webp'].includes(ext)) return null;
    const base = path.join(path.dirname(input), path.basename(input, path.extname(input)) + '-lumen');
    let out = `${base}.${ext}`, i = 2;
    while (fs.existsSync(out)) out = `${base}-${i++}.${ext}`;
    fs.writeFileSync(out, Buffer.from(bytes));
    return out;
  });
  on('tools-reveal', (p) => shell.showItemInFolder(p));

  // ====================================================================
  // Snippet (espansione testo ovunque) — processo separato con hook della tastiera
  // ====================================================================
  let snip = null, snipWanted = false;
  function syncSnippets() {
    const s = S();
    snipWanted = !!s.snippetsEnabled && (s.snippets || []).some(x => x.trigger && x.text);
    if (snip) { const p = snip; snip = null; try { p.kill(); } catch {} }
    if (!snipWanted) return;
    const dir = app.getPath('userData');
    const file = path.join(dir, 'snippets.json');
    fs.writeFileSync(file, JSON.stringify(s.snippets.filter(x => x.trigger && x.text)));
    const script = path.join(dir, 'lumen-snippets.ps1');
    fs.writeFileSync(script, '﻿' + fs.readFileSync(path.join(__dirname, '..', 'native', 'snippets.ps1'), 'utf8').replace(/^﻿/, ''));
    const p = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', script, '-SnippetsFile', file], { windowsHide: true, stdio: 'ignore' });
    snip = p;
    p.on('exit', () => { if (snip === p) { snip = null; if (snipWanted) setTimeout(syncSnippets, 3000); } });
  }
  syncSnippets();
  hooks.onPatch.push((p) => { if ('snippets' in p || 'snippetsEnabled' in p) syncSnippets(); });
  app.on('before-quit', () => { snipWanted = false; if (snip) try { snip.kill(); } catch {} });

  // ====================================================================
  // Ricerca rapida: snippet, browser e comandi aggiuntivi
  // ====================================================================
  const browser = new BrowserSearch(app.getPath('userData'));
  hooks.onPatch.push((p) => { if (p.launcherBrowser === false) browser.clearCache(); });

  // Analisi disco (PuliDisco)
  require('./disk').install(c);

  const EXTRA_CMDS = [
    { id: 'disk', glyph: 'cpu', run: () => hooks.disk && hooks.disk() },
    { id: 'mission', glyph: 'grid', run: () => setTimeout(mission, 150) },
    { id: 'launchpad', glyph: 'apps', run: () => setTimeout(() => hooks.launchpad && hooks.launchpad(), 150) },
    { id: 'panel', glyph: 'bell', run: () => setTimeout(panel, 150) },
    { id: 'picker', glyph: 'contrast', run: () => setTimeout(picker, 300) },
    { id: 'newDesktop', glyph: 'desktop', run: () => fast.safe('newDesktop') },
    { id: 'profWork', glyph: 'layout', run: () => applyProfile('work') },
    { id: 'profGame', glyph: 'play', run: () => applyProfile('game') },
    { id: 'profBattery', glyph: 'power', run: () => applyProfile('battery') },
    { id: 'profLive', glyph: 'screenshot', run: () => applyProfile('live') },
    { id: 'profNone', glyph: 'restart', run: () => applyProfile(null) },
  ];
  hooks.search.push(async (q) => {
    const ql = q.trim().toLowerCase();
    if (!ql) return [];
    const out = [];
    for (const cmd of EXTRA_CMDS) {
      const name = t('cmd.' + cmd.id), kw = t('cmdk.' + cmd.id);
      if (name.toLowerCase().includes(ql) || kw.split(',').some(k => k.trim() && (k.trim().startsWith(ql) || ql.startsWith(k.trim())))) {
        out.push({ kind: 'morecmd', id: cmd.id, name, glyph: cmd.glyph, section: 'commands', hint: t('launcher.command') });
      }
    }
    for (const sn of S().snippets || []) {
      if (!sn.trigger || !sn.text) continue;
      if (sn.trigger.toLowerCase().includes(ql) || sn.text.toLowerCase().includes(ql)) {
        out.push({ kind: 'snippet', id: sn.trigger, name: sn.text.replace(/\s+/g, ' ').slice(0, 70), sub: sn.trigger, glyph: 'text', section: 'snippets', hint: t('launcher.paste') });
      }
    }
    if (S().launcherBrowser) {
      for (const b of browser.search(q)) {
        if (!/^https?:/i.test(b.url)) continue;
        out.push({ kind: 'url', url: b.url, name: b.name, sub: `${b.browser} · ${b.url}`, glyph: b.kind === 'bookmark' ? 'pin' : 'globe', section: 'browser' });
      }
    }
    return out;
  });
  hooks.run.morecmd = (item) => { const cmd = EXTRA_CMDS.find(x => x.id === item.id); cmd && cmd.run(); };
  hooks.run.snippet = async (item) => {
    const sn = (S().snippets || []).find(x => x.trigger === item.id);
    if (!sn) return;
    await clipboard.writeText(sn.text);
    if (c.state.prevFg) { await fast.safe('focus', { hwnd: c.state.prevFg.hwnd }); setTimeout(() => fast.safe('paste'), 90); }
  };

  // ====================================================================
  // Pulizia programmata e avvisi
  // ====================================================================
  async function autoClean(force) {
    const s = S();
    if (!s.autoClean && !force) return;
    if (!force && Date.now() - (s.lastAutoClean || 0) < 7 * 86400000) return;
    const r = await slow.safe('cleanTemp', { dry: false }, null, 180000);
    let recycled = false;
    if (s.autoCleanRecycle) { await fast.safe('emptyRecycle', {}, null, 60000); recycled = true; }
    c.patch({ lastAutoClean: Date.now() });
    if (r) notify(t('auto.done'), t(recycled ? 'auto.doneBodyRecycle' : 'auto.doneBody', { s: c.mb(r.bytes) }), () => c.openSettings('prestazioni'));
  }
  setTimeout(() => autoClean(false), 90 * 1000);
  setInterval(() => autoClean(false), 6 * 3600 * 1000);

  const alert = { high: 0, memAt: 0, diskAt: 0 };
  setInterval(() => {
    const s = S();
    if (!s.alertsEnabled) return;
    const mem = 1 - os.freemem() / os.totalmem();
    alert.high = mem > 0.92 ? alert.high + 1 : 0;
    if (alert.high >= 3 && Date.now() - alert.memAt > 30 * 60000) {
      alert.memAt = Date.now();
      notify(t('alert.mem'), t('alert.memBody', { p: Math.round(mem * 100) }), () => c.openSettings('prestazioni'));
    }
    try {
      const st = fs.statfsSync((process.env.SystemDrive || 'C:') + '\\');
      const free = st.bavail / st.blocks;
      if (free < 0.1 && Date.now() - alert.diskAt > 24 * 3600000) {
        alert.diskAt = Date.now();
        notify(t('alert.disk'), t('alert.diskBody', { s: c.mb(st.bavail * st.bsize) }), () => (hooks.disk ? hooks.disk() : c.openSettings('prestazioni')));
      }
    } catch {}
  }, 60 * 1000);

  // ====================================================================
  // Scorciatoie
  // ====================================================================
  hooks.shortcuts.push((reg) => {
    const s = S();
    reg('mission', s.missionShortcut, mission);
    reg('quicklook', s.quickLookShortcut, quickLook);
    reg('picker', s.pickerShortcut, picker);
  });
};
