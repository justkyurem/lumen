const {
  app, BrowserWindow, ipcMain, screen, shell, dialog, Menu, nativeTheme, Tray, nativeImage,
  globalShortcut, desktopCapturer, Notification, net,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { Helper } = require('./native/helper');
const { Store, THEME_KEYS, uid } = require('./store');
const { AppIndex, exeFrom } = require('./features/apps');
const { ClipHistory } = require('./features/clipboard');
const I18N = require('./ui/i18n');

// Solo per le prove: profilo separato, così non interferisce con la Lumen installata
if (process.env.LUMEN_TEST_PROFILE) app.setPath('userData', process.env.LUMEN_TEST_PROFILE);
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const UI = (f) => path.join(__dirname, 'ui', f);
const PRELOAD = path.join(__dirname, 'preload.js');

let store, S;                       // S = store.data
let fast, slow;                     // helper nativi: fast (finestre, polling) e slow (WinRT, ricerca)
let apps, clips;
const W = { dock: null, bars: new Map(), launcher: null, clip: null, control: null, popover: null, widgets: null, settings: null, onboarding: null };
let tray;
let quitting = false;
const state = {
  windows: [], fg: null, prevFg: null, fullscreen: null, pomo: null, stats: null, weather: null,
  unpinned: [], running: [], recycle: 0, popoverMode: null, previewKey: null,
};

const t = (k, v) => I18N.t(S.lang, k, v);
const alive = (w) => w && !w.isDestroyed();
const hwndOf = (w) => { const b = w.getNativeWindowHandle(); return Number(b.length >= 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0)); };
const allWins = () => Object.entries(W).flatMap(([k, v]) => (k === 'bars' ? [...v.values()] : [v])).filter(alive);
const send = (w, ch, data) => { if (alive(w)) w.webContents.send(ch, data); };
const sendBars = (ch, data) => W.bars.forEach(b => send(b, ch, data));

// Modalità leggera di Lumen: spegne le parti più costose senza toccare le preferenze salvate.
const LITE_OFF = { widgetsEnabled: false, dockPreviews: false, dockShowUnpinned: false, menubarShowStats: false, dockMagnify: false };
function eff() { return S.liteMode ? { ...S, ...LITE_OFF } : S; }
function payload(raw) { return { ...(raw ? S : eff()), dark: nativeTheme.shouldUseDarkColors, version: app.getVersion() }; }
const isPrefsWin = (w) => w === W.settings || w === W.onboarding;

function broadcast() {
  nativeTheme.themeSource = S.theme === 'auto' ? 'system' : S.theme;
  const pe = payload(false), pr = payload(true);
  for (const w of allWins()) w.webContents.send('settings', isPrefsWin(w) ? pr : pe);
  const p = pr;
  for (const w of [W.settings, W.onboarding].filter(alive)) {
    try { w.setTitleBarOverlay({ symbolColor: p.dark ? '#fff' : '#000' }); } catch {}
    w.setBackgroundColor(p.dark ? '#1c1c1f' : '#ececef');
  }
}

// ======================================================================
// Finestre
// ======================================================================

const overlay = (extra) => ({
  frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
  skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: '#00000000',
  webPreferences: { preload: PRELOAD, contextIsolation: true, spellcheck: false },
  ...extra,
});

const primary = () => screen.getPrimaryDisplay();

// ---------- Dock ----------
function dockItemCount() {
  let n = S.apps.length + 1; // + Personalizza
  if (eff().dockShowUnpinned) n += state.unpinned.length;
  if (S.dockShowTrash) n += 1;
  if (S.dockShowLaunchpad) n += 1;
  return Math.max(n, 3);
}
// Spazio riservato in basso per il dock (DIP): l'area di lavoro lo esclude già, quindi lo riaggiungiamo per posizionare il dock
let dockReservedH = 0;
const dockStripH = () => eff().dockSize + 22;
function dockBounds() {
  const wa = primary().workArea;
  const E = eff(), s = E.dockSize, scale = E.dockMagnify ? E.dockMagnifyScale : 1;
  const width = Math.min(wa.width, Math.round(dockItemCount() * (s + 6) + 70 + s * (scale - 1) * 3.2));
  const height = Math.round(s * scale + 64);
  const bottom = wa.y + wa.height + dockReservedH;
  return { x: Math.round(wa.x + (wa.width - width) / 2), y: bottom - height, width, height };
}
function createDock() {
  W.dock = new BrowserWindow(overlay({ ...dockBounds(), focusable: false }));
  W.dock.setAlwaysOnTop(true, 'screen-saver');
  W.dock.setIgnoreMouseEvents(true, { forward: true });
  W.dock.loadFile(UI('dock.html'));
  W.dock.once('ready-to-show', () => { W.dock.showInactive(); reserveDock(); });
}

// Riserva lo spazio del dock come una barra di sistema: le finestre massimizzate si fermano sopra il dock
let dockReserveBusy = false, dockReserveAgain = false;
async function reserveDock() {
  if (!alive(W.dock)) return;
  if (dockReserveBusy) { dockReserveAgain = true; return; }
  dockReserveBusy = true;
  try {
    const want = S.dockReserve && !eff().dockAutoHide && state.fullscreen !== primary().id;
    const h = hwndOf(W.dock);
    if (!want) {
      if (dockReservedH) { await fast.safe('appBarRemove', { hwnds: [h] }); dockReservedH = 0; }
    } else {
      const p = primary();
      const strip = dockStripH();
      if (dockReservedH !== strip) {
        // la striscia parte dal fondo dell'area di lavoro attuale (sopra la barra di Windows, se visibile)
        const base = p.workArea.y + p.workArea.height + dockReservedH;
        const r = screen.dipToScreenRect(W.dock, { x: p.bounds.x, y: base - strip, width: p.bounds.width, height: strip });
        await fast.safe('appBarBottom', { hwnd: h, l: r.x, t: r.y, r: r.x + r.width, b: r.y + r.height });
        dockReservedH = strip;
      }
    }
  } finally { dockReserveBusy = false; }
  if (dockReserveAgain) { dockReserveAgain = false; return reserveDock(); }
  setTimeout(() => { if (alive(W.dock)) W.dock.setBounds(dockBounds()); }, 400);
}

// ---------- Barre dei menu (una per monitor) ----------
const BAR_H = 28;
function barDisplays() { return S.menubarAllDisplays ? screen.getAllDisplays() : [primary()]; }

function syncBars() {
  const wanted = S.showMenubar ? new Map(barDisplays().map(d => [d.id, d])) : new Map();
  for (const [id, w] of W.bars) {
    if (!wanted.has(id)) { releaseAppBar(w); if (alive(w)) w.destroy(); W.bars.delete(id); }
  }
  for (const [id, d] of wanted) {
    const b = { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: BAR_H };
    let w = W.bars.get(id);
    if (!alive(w)) {
      w = new BrowserWindow(overlay({ ...b, focusable: false }));
      w.setAlwaysOnTop(true, 'screen-saver');
      w.loadFile(UI('menubar.html'));
      w.once('ready-to-show', () => { if (state.fullscreen !== id) w.showInactive(); reserveAppBar(w, d); });
      W.bars.set(id, w);
    } else {
      w.setBounds(b);
      reserveAppBar(w, d);
    }
    // Barra a scomparsa: i clic passano alle finestre sotto finché il mouse non arriva sul bordo in alto
    w.setIgnoreMouseEvents(!!S.menubarAutoHide, { forward: true });
  }
}

async function reserveAppBar(w, d) {
  if (!alive(w)) return;
  const h = hwndOf(w);
  if (!S.menubarReserve || S.menubarAutoHide || state.fullscreen === d.id) return fast.safe('appBarRemove', { hwnds: [h] });
  const r = screen.dipToScreenRect(w, { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: BAR_H });
  await fast.safe('appBar', { hwnd: h, l: r.x, t: r.y, r: r.x + r.width, b: r.y + r.height });
  if (alive(w)) w.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: BAR_H });
}
function releaseAppBar(w) { if (alive(w)) return fast.safe('appBarRemove', { hwnds: [hwndOf(w)] }); }

// ---------- Finestre a comparsa (create al primo uso, poi riusate) ----------
// Le finestre usate di rado vengono distrutte dopo un po' che sono nascoste, per liberare memoria.
const RECYCLE = new Set(['clip', 'control', 'popover', 'mission', 'panel', 'ql', 'launchpad']);
function lazy(key, file, opts, setup) {
  if (alive(W[key])) { clearTimeout(W[key]._recycle); return W[key]; }
  const w = new BrowserWindow(overlay(opts));
  w.loadFile(UI(file));
  setup && setup(w);
  if (RECYCLE.has(key)) {
    w.on('hide', () => {
      clearTimeout(w._recycle);
      w._recycle = setTimeout(() => { if (alive(w) && !w.isVisible()) { w.destroy(); if (W[key] === w) W[key] = null; } }, 3 * 60000);
    });
  }
  W[key] = w;
  return w;
}

function centerOn(w, width, height, topRatio = 0.22) {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = d.workArea;
  w.setBounds({ x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + wa.height * topRatio), width, height });
}

async function rememberForeground() {
  const fg = await fast.safe('foreground', {}, null, 1000);
  if (fg && fg.pid !== process.pid) state.prevFg = fg;
}

// Ricerca rapida
async function toggleLauncher() {
  const w = lazy('launcher', 'launcher.html', { width: 680, height: 470, focusable: true }, (w) => {
    w.on('blur', () => { if (!w.webContents.isDevToolsOpened()) w.hide(); });
  });
  if (w.isVisible()) return w.hide();
  await rememberForeground();
  centerOn(w, 680, 470);
  w.show(); w.focus();
  send(w, 'launcher-open');
}

// Appunti
async function toggleClipboard() {
  if (!S.clipboardEnabled) return;
  const w = lazy('clip', 'clipboard.html', { width: 760, height: 480, focusable: true }, (w) => {
    w.on('blur', () => w.hide());
  });
  if (w.isVisible()) return w.hide();
  await rememberForeground();
  centerOn(w, 760, 480, 0.18);
  w.show(); w.focus();
  send(w, 'clips', clips.items);
  send(w, 'clip-open');
}

// Centro di controllo
function toggleControl(anchorX) {
  const w = lazy('control', 'control.html', { width: 340, height: 520, focusable: true }, (w) => {
    w.on('blur', () => w.hide());
  });
  if (w.isVisible()) return w.hide();
  const cur = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(cur);
  const x = Math.min(Math.max((anchorX ?? cur.x) - 300, d.bounds.x + 8), d.bounds.x + d.bounds.width - 348);
  w.setBounds({ x: Math.round(x), y: d.bounds.y + BAR_H + 6, width: 340, height: w.getBounds().height });
  w.show(); w.focus();
  send(w, 'control-open');
}

// Popover del dock (pile di cartelle e anteprime finestre)
function popover() {
  return lazy('popover', 'popover.html', { width: 300, height: 200, focusable: true }, (w) => {
    w.setAlwaysOnTop(true, 'screen-saver');
    w.on('blur', () => { if (state.popoverMode === 'stack') hidePopover(); });
  });
}
function hidePopover() { if (alive(W.popover)) W.popover.hide(); state.popoverMode = null; state.previewKey = null; }
let popAnchor = null;
function placePopover(w, h) {
  if (!popAnchor || !alive(W.popover)) return;
  const wa = primary().workArea;
  const x = Math.min(Math.max(Math.round(popAnchor.x - w / 2), wa.x + 6), wa.x + wa.width - w - 6);
  W.popover.setBounds({ x, y: Math.round(popAnchor.y - h - 4), width: Math.round(w), height: Math.round(h) });
}

// Widget sul desktop
function syncWidgets() {
  if (!eff().widgetsEnabled) { if (alive(W.widgets)) W.widgets.destroy(); W.widgets = null; return; }
  const wa = primary().workArea;
  if (alive(W.widgets)) { W.widgets.setBounds(wa); return; }
  W.widgets = new BrowserWindow(overlay({ ...wa, alwaysOnTop: false, focusable: true }));
  W.widgets.setIgnoreMouseEvents(true, { forward: true });
  W.widgets.loadFile(UI('widgets.html'));
  W.widgets.once('ready-to-show', () => { W.widgets.showInactive(); sendWidgetsToBack(); });
  W.widgets.on('blur', sendWidgetsToBack);
}
function sendWidgetsToBack() { if (alive(W.widgets)) fast.safe('bottom', { hwnd: hwndOf(W.widgets) }); }
function toggleWidgets() { patch({ widgetsEnabled: !S.widgetsEnabled }); }

// Impostazioni e benvenuto
function framedWindow(file, opts) {
  const dark = nativeTheme.shouldUseDarkColors;
  const w = new BrowserWindow({
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#fff' : '#000', height: 40 },
    backgroundColor: dark ? '#1c1c1f' : '#ececef',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true },
    ...opts,
  });
  w.loadFile(UI(file));
  w.once('ready-to-show', () => w.show());
  return w;
}
function openSettings(tab) {
  if (alive(W.settings)) { W.settings.show(); W.settings.focus(); if (tab) send(W.settings, 'tab', tab); return; }
  W.settings = framedWindow('settings.html', { width: 860, height: 620, minWidth: 760, minHeight: 520, title: 'Lumen' });
  if (tab) W.settings.webContents.once('did-finish-load', () => send(W.settings, 'tab', tab));
}
function openOnboarding() {
  if (alive(W.onboarding)) return W.onboarding.focus();
  W.onboarding = framedWindow('onboarding.html', { width: 720, height: 540, resizable: false, maximizable: false, title: 'Lumen' });
}

function relayout() {
  if (alive(W.dock)) W.dock.setBounds(dockBounds());
  reserveDock();
  syncBars();
  syncWidgets();
}

// ======================================================================
// Impostazioni
// ======================================================================

function patch(p) {
  const prev = { ...S };
  store.patch(p);
  S = store.data;
  if ('launchAtLogin' in p) {
    app.setLoginItemSettings({ openAtLogin: S.launchAtLogin, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
  }
  if (('wallpaper' in p || 'wallpaperMode' in p || 'dynamicWallpapers' in p)) applyWallpaper(true);
  if (['launcherEnabled', 'launcherShortcut', 'clipboardEnabled', 'clipboardShortcut', 'snapEnabled'].some(k => k in p)) registerShortcuts();
  if ('clipboardEnabled' in p) S.clipboardEnabled ? clips.start() : clips.stop();
  if ('weatherCity' in p && p.weatherCity !== prev.weatherCity) { state.weather = null; refreshWeather(); }
  if ('lang' in p) { buildTray(); }
  if (['missionShortcut', 'quickLookShortcut', 'pickerShortcut', 'launchpadShortcut'].some(k => k in p)) registerShortcuts();
  for (const f of hooks.onPatch) { try { f(p); } catch {} }
  relayout();
  broadcast();
}

// ======================================================================
// Avvio app, finestre, cestino
// ======================================================================

function isUrlish(p) { return /^[a-z][a-z0-9+.-]*:/i.test(p) && !/^[a-z]:\\/i.test(p); }

function launchPath(p) {
  if (!p) return;
  if (/^shell:/i.test(p)) execFile('explorer.exe', [p]);
  else if (isUrlish(p)) shell.openExternal(p);
  else shell.openPath(p);
}

function itemExe(a) { return a.exe || exeFrom(a.path); }
function windowsForExe(exe) {
  if (!exe) return [];
  return state.windows.filter(w => w.exe && path.basename(w.exe).toLowerCase() === exe);
}

async function activateExe(exe, fallbackPath) {
  const wins = windowsForExe(exe);
  if (!wins.length) return launchPath(fallbackPath);
  const fgIdx = wins.findIndex(w => state.fg && w.hwnd === state.fg.hwnd);
  const target = fgIdx >= 0 && wins.length > 1 ? wins[(fgIdx + 1) % wins.length] : wins[0];
  await fast.safe('focus', { hwnd: target.hwnd });
}

function confirmBox(message, detail, okLabel) {
  return dialog.showMessageBox({ type: 'question', message, detail, buttons: [okLabel, t('common.cancel')], defaultId: 1, cancelId: 1 })
    .then(r => r.response === 0);
}

async function emptyTrash() {
  if (await confirmBox(t('trash.confirm'), t('trash.confirmDetail'), t('trash.empty'))) {
    await fast.safe('emptyRecycle');
    refreshRecycle();
  }
}
async function refreshRecycle() {
  const n = await fast.safe('recycleCount', {}, 0);
  if (n !== state.recycle) { state.recycle = n; send(W.dock, 'recycle', n); }
}

const POWER = {
  lock: () => execFile('rundll32.exe', ['user32.dll,LockWorkStation']),
  sleep: () => fast.safe('sleep'),
  restart: async () => { if (await confirmBox(t('power.restartQ'), '', t('power.restart'))) execFile('shutdown.exe', ['/r', '/t', '0']); },
  shutdown: async () => { if (await confirmBox(t('power.shutdownQ'), '', t('power.shutdown'))) execFile('shutdown.exe', ['/s', '/t', '0']); },
};

// ======================================================================
// Polling finestre / app attiva
// ======================================================================

const IGNORED_EXE = new Set(['applicationframehost.exe', 'textinputhost.exe', 'shellexperiencehost.exe', 'searchhost.exe', 'startmenuexperiencehost.exe', 'lockapp.exe']);
const descCache = new Map();
async function describe(exePath) {
  if (descCache.has(exePath)) return descCache.get(exePath);
  const d = await fast.safe('describe', { exe: exePath }, path.basename(exePath, '.exe'));
  descCache.set(exePath, d);
  return d;
}

// Python, Java, Node e simili eseguono app di altri: il loro nome non dice nulla, il titolo della finestra sì
const HOST_EXE = /^(python|pythonw|py|pyw|java|javaw|node|deno|bun|wscript|cscript|mshta|rundll32|autohotkey(64|32)?|love|lua|ruby|rubyw|perl)\.exe$/i;
function hostTitle(w) {
  if (!w || !w.exe || !HOST_EXE.test(path.basename(w.exe))) return null;
  const t = (w.title || '').trim();
  return t ? (t.length > 40 ? t.slice(0, 39) + '…' : t) : null;
}

async function pollForeground() {
  const fg = await fast.safe('foreground', {}, null, 1500);
  if (!fg || fg.pid === process.pid) {
    // L'app a schermo intero è stata chiusa e il primo piano non è passato a un'altra finestra: barra e dock tornano
    if (state.fullscreen != null && !state.windows.some(w => w.hwnd === state.fullHwnd)) checkFullscreen({});
    return;
  }
  fg.name = hostTitle(fg) || fg.name;
  const changed = !state.fg || fg.hwnd !== state.fg.hwnd || fg.name !== state.fg.name;
  state.fg = fg;
  if (changed) sendBars('active-app', { name: fg.name, exe: fg.exe });
  checkFullscreen(fg);
}

// App a schermo intero (giochi, video, F11): barra e dock si tolgono di mezzo su quel monitor, come su macOS
function checkFullscreen(fg) {
  let full = null;
  const isDesktop = /\\explorer\.exe$/i.test(fg.exe || '') && (!fg.title || fg.title === 'Program Manager');
  if (!isDesktop && fg.full && fg.w > 0) {
    const c = screen.screenToDipPoint({ x: fg.x + Math.round(fg.w / 2), y: fg.y + Math.round(fg.h / 2) });
    full = screen.getDisplayNearestPoint(c).id;
  }
  if (full === state.fullscreen) { if (full != null) state.fullHwnd = fg.hwnd; return; }
  const was = state.fullscreen;
  state.fullscreen = full;
  state.fullHwnd = full != null ? fg.hwnd : null;
  // Su quel monitor barra e dock spariscono e liberano lo spazio riservato; tornano quando l'app smette di essere in primo piano
  for (const [id, w] of W.bars) {
    if (!alive(w) || !S.showMenubar) continue;
    const d = screen.getAllDisplays().find(x => x.id === id);
    if (id === full) { w.hide(); releaseAppBar(w); }
    else { w.showInactive(); if (id === was && d) reserveAppBar(w, d); }
  }
  if (alive(W.dock)) {
    if (full === primary().id) { W.dock.hide(); reserveDock(); }
    else { W.dock.showInactive(); if (was === primary().id) reserveDock(); }
  }
}

let lastWinSig = '';
async function pollWindows() {
  const list = await fast.safe('windows', { exclude: process.pid }, null, 2500);
  if (!list) return;
  state.windows = list.filter(w => w.exe && !IGNORED_EXE.has(path.basename(w.exe).toLowerCase()));
  const runningExes = new Set(state.windows.map(w => path.basename(w.exe).toLowerCase()));
  const pinnedExes = new Set(S.apps.map(itemExe).filter(Boolean));
  const running = S.apps.filter(a => runningExes.has(itemExe(a))).map(a => a.id);
  const unpinned = [];
  const seen = new Set();
  for (const w of state.windows) {
    const exe = path.basename(w.exe).toLowerCase();
    if (pinnedExes.has(exe) || seen.has(exe)) continue;
    seen.add(exe);
    unpinned.push({ key: exe, exePath: w.exe, name: hostTitle(w) || await describe(w.exe), icon: await apps.bestIcon({ exe: w.exe, src: w.exe }) });
  }
  const sig = running.join() + '|' + unpinned.map(u => u.key).join();
  if (sig === lastWinSig) return;
  const countChanged = unpinned.length !== state.unpinned.length;
  lastWinSig = sig;
  state.running = running;
  state.unpinned = unpinned;
  if (countChanged && alive(W.dock)) W.dock.setBounds(dockBounds());
  send(W.dock, 'running', { running, unpinned });
}

// ======================================================================
// Angoli attivi
// ======================================================================

const CORNER_ACTIONS = {
  none: () => {},
  launcher: () => toggleLauncher(),
  control: () => toggleControl(),
  desktop: () => fast.safe('showDesktop'),
  lock: () => POWER.lock(),
  widgets: () => toggleWidgets(),
  clipboard: () => toggleClipboard(),
  settings: () => openSettings(),
  mission: () => hooks.mission && hooks.mission(),
  launchpad: () => hooks.launchpad && hooks.launchpad(),
  panel: () => hooks.panel && hooks.panel(),
};
const corner = { at: null, since: 0, fired: false };
function pollCorners() {
  const p = screen.getCursorScreenPoint();
  let hit = null;
  for (const d of screen.getAllDisplays()) {
    const b = d.bounds, r = b.x + b.width - 1, bt = b.y + b.height - 1;
    if (p.x <= b.x + 1 && p.y <= b.y + 1) hit = 'tl';
    else if (p.x >= r - 1 && p.y <= b.y + 1) hit = 'tr';
    else if (p.x <= b.x + 1 && p.y >= bt - 1) hit = 'bl';
    else if (p.x >= r - 1 && p.y >= bt - 1) hit = 'br';
    if (hit) break;
  }
  if (hit !== corner.at) { corner.at = hit; corner.since = Date.now(); corner.fired = false; return; }
  // Serve fermarsi nell'angolo per un attimo: passarci sopra per chiudere una finestra non deve aprire nulla.
  // Sopra un'app a schermo intero (giochi, video) gli angoli non fanno niente.
  if (hit && !corner.fired && Date.now() - corner.since > 450 && state.fullscreen == null) {
    corner.fired = true;
    (CORNER_ACTIONS[S.hotCorners[hit]] || CORNER_ACTIONS.none)();
  }
}

// ======================================================================
// Scorciatoie globali
// ======================================================================

const SNAP_KEYS = {
  left: 'Control+Alt+Left', right: 'Control+Alt+Right', top: 'Control+Alt+Up', bottom: 'Control+Alt+Down',
  max: 'Control+Alt+Enter', center: 'Control+Alt+C', almost: 'Control+Alt+M',
  tl: 'Control+Alt+U', tr: 'Control+Alt+I', bl: 'Control+Alt+J', br: 'Control+Alt+K',
  left3: 'Control+Alt+D', center3: 'Control+Alt+F', right3: 'Control+Alt+G',
};
const shortcutStatus = {};
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const reg = (name, acc, fn) => {
    if (!acc) return;
    try { shortcutStatus[name] = globalShortcut.register(acc.replace(/^Ctrl/, 'Control'), fn); }
    catch { shortcutStatus[name] = false; }
  };
  if (S.launcherEnabled) reg('launcher', S.launcherShortcut, toggleLauncher);
  if (S.clipboardEnabled) reg('clipboard', S.clipboardShortcut, toggleClipboard);
  if (S.snapEnabled) for (const [where, acc] of Object.entries(SNAP_KEYS)) reg('snap-' + where, acc, () => fast.safe('snap', { where }));
  for (const f of hooks.shortcuts) f(reg);
}

// ======================================================================
// Layout finestre
// ======================================================================

async function saveLayout(name) {
  const list = await fast.safe('windows', { exclude: process.pid }, []);
  const windows = list.filter(w => !w.min && w.exe && !IGNORED_EXE.has(path.basename(w.exe).toLowerCase()))
    .map(w => ({ exe: path.basename(w.exe).toLowerCase(), title: w.title, x: w.x, y: w.y, w: w.w, h: w.h, max: w.max }));
  patch({ layouts: [...S.layouts.filter(l => l.name !== name), { id: uid(), name, windows }] });
  return windows.length;
}
async function restoreLayout(id) {
  const l = S.layouts.find(x => x.id === id);
  if (!l) return 0;
  const cur = await fast.safe('windows', { exclude: process.pid }, []);
  const used = new Set(), moves = [];
  for (const sw of l.windows) {
    const cands = cur.filter(w => w.exe && path.basename(w.exe).toLowerCase() === sw.exe && !used.has(w.hwnd));
    const m = cands.find(w => w.title === sw.title) || cands[0];
    if (!m) continue;
    used.add(m.hwnd);
    moves.push({ hwnd: m.hwnd, x: sw.x, y: sw.y, w: sw.w, h: sw.h, max: sw.max });
  }
  await fast.safe('move', { list: moves });
  return moves.length;
}

// ======================================================================
// Concentrazione (Pomodoro)
// ======================================================================

let pomoTimer = null;
function startPomo(mode) {
  const min = mode === 'break' ? S.breakMinutes : S.focusMinutes;
  state.pomo = { mode, endsAt: Date.now() + min * 60000, total: min * 60000 };
  clearTimeout(pomoTimer);
  pomoTimer = setTimeout(endPomo, min * 60000);
  sendBars('pomo', state.pomo);
  send(W.control, 'pomo', state.pomo);
}
function stopPomo() {
  clearTimeout(pomoTimer);
  state.pomo = null;
  sendBars('pomo', null);
  send(W.control, 'pomo', null);
}
function endPomo() {
  const was = state.pomo && state.pomo.mode;
  stopPomo();
  const n = new Notification({
    title: was === 'focus' ? t('pomo.focusDone') : t('pomo.breakDone'),
    body: was === 'focus' ? t('pomo.focusDoneBody', { m: S.breakMinutes }) : t('pomo.breakDoneBody'),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
  });
  n.on('click', () => startPomo(was === 'focus' ? 'break' : 'focus'));
  n.show();
  sendBars('pomo-ding');
}

// ======================================================================
// Statistiche sistema, meteo, sfondo dinamico
// ======================================================================

let lastCpu = os.cpus();
function sampleStats() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  cpus.forEach((c, i) => {
    const p = lastCpu[i] ? lastCpu[i].times : { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const cur = c.times;
    const tt = (cur.user - p.user) + (cur.nice - p.nice) + (cur.sys - p.sys) + (cur.idle - p.idle) + (cur.irq - p.irq);
    total += tt; idle += cur.idle - p.idle;
  });
  lastCpu = cpus;
  let disk = null;
  try { const s = fs.statfsSync(process.env.SystemDrive ? process.env.SystemDrive + '\\' : 'C:\\'); disk = 1 - s.bavail / s.blocks; } catch {}
  state.stats = {
    cpu: total ? 1 - idle / total : 0,
    mem: 1 - os.freemem() / os.totalmem(),
    memUsed: os.totalmem() - os.freemem(), memTotal: os.totalmem(),
    disk, uptime: os.uptime(),
  };
  sendBars('stats', state.stats);
  send(W.widgets, 'stats', state.stats);
}

async function getJSON(url) {
  const r = await net.fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function refreshWeather() {
  if (!S.weatherCity) { state.weather = null; return send(W.widgets, 'weather', null); }
  try {
    const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=${S.lang}&name=${encodeURIComponent(S.weatherCity)}`);
    const loc = g.results && g.results[0];
    if (!loc) throw new Error('city');
    const f = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=5&timezone=auto');
    state.weather = { city: loc.name, current: f.current, daily: f.daily, at: Date.now() };
  } catch (e) {
    state.weather = { error: e.message === 'city' ? 'city' : 'net' };
  }
  send(W.widgets, 'weather', state.weather);
}

const rates = { at: 0, base: null, data: null };
async function convertCurrency(amount, from, to) {
  from = from.toUpperCase(); to = to.toUpperCase();
  if (rates.base !== from || Date.now() - rates.at > 3600000) {
    const r = await getJSON(`https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}`);
    rates.base = from; rates.data = r.rates; rates.at = Date.now();
  }
  const rate = rates.data[to];
  return rate ? { value: amount * rate, rate } : null;
}

let lastWallpaper = null;
function phase() {
  const h = new Date().getHours();
  return h >= 6 && h < 9 ? 'dawn' : h >= 9 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night';
}
function applyWallpaper(force) {
  let file = null;
  if (S.wallpaperMode === 'dynamic') {
    const dw = S.dynamicWallpapers;
    const order = ['dawn', 'day', 'dusk', 'night'];
    const p = phase();
    file = dw[p] || order.map(k => dw[k]).find(Boolean);
  } else file = S.wallpaper;
  if (!file || !fs.existsSync(file)) return;
  if (!force && file === lastWallpaper) return;
  lastWallpaper = file;
  fast.safe('wallpaper', { path: file });
}

// ======================================================================
// Aggiornamenti automatici
// ======================================================================

let updater = null;
function updaterAvailable() {
  return app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
}
async function checkUpdates(manual) {
  if (!updaterAvailable()) return { status: 'unconfigured' };
  try {
    if (!updater) {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = true;
      updater.on('update-downloaded', (info) => {
        const n = new Notification({ title: t('update.ready'), body: t('update.readyBody', { v: info.version }) });
        n.on('click', () => updater.quitAndInstall());
        n.show();
      });
    }
    const r = await updater.checkForUpdates();
    const v = r && r.updateInfo && r.updateInfo.version;
    return { status: v && v !== app.getVersion() ? 'downloading' : 'latest', version: v };
  } catch (e) {
    return { status: 'error', error: manual ? e.message : undefined };
  }
}

// ======================================================================
// Menu
// ======================================================================

function logoMenuTemplate() {
  return [
    { label: t('menu.about'), click: () => dialog.showMessageBox({ message: 'Lumen ' + app.getVersion(), detail: t('menu.aboutDetail'), icon: nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')) }) },
    { type: 'separator' },
    { label: t('menu.settings'), accelerator: undefined, click: () => openSettings() },
    { label: t('menu.search') + '   ' + S.launcherShortcut.replace('Space', t('key.space')), click: toggleLauncher, enabled: S.launcherEnabled },
    { label: t('menu.clipboard') + '   ' + S.clipboardShortcut, click: toggleClipboard, enabled: S.clipboardEnabled },
    { label: S.widgetsEnabled ? t('menu.hideWidgets') : t('menu.showWidgets'), click: toggleWidgets },
    { type: 'separator' },
    {
      label: t('menu.focus'), submenu: state.pomo ? [{ label: t('pomo.stop'), click: stopPomo }] : [
        { label: t('pomo.startFocus', { m: S.focusMinutes }), click: () => startPomo('focus') },
        { label: t('pomo.startBreak', { m: S.breakMinutes }), click: () => startPomo('break') },
      ],
    },
    {
      label: t('menu.layouts'), submenu: [
        ...S.layouts.map(l => ({ label: l.name, click: () => restoreLayout(l.id) })),
        ...(S.layouts.length ? [{ type: 'separator' }] : []),
        { label: t('layout.manage'), click: () => openSettings('finestre') },
      ],
    },
    { type: 'separator' },
    { label: t('menu.winSettings'), click: () => shell.openExternal('ms-settings:') },
    { type: 'separator' },
    { label: t('power.lock'), click: POWER.lock },
    { label: t('power.sleep'), click: POWER.sleep },
    { label: t('power.restart') + '…', click: POWER.restart },
    { label: t('power.shutdown') + '…', click: POWER.shutdown },
    { type: 'separator' },
    { label: t('menu.quit'), click: () => app.quit() },
  ];
}

function makeTrayIcon() {
  const Sz = 32, buf = Buffer.alloc(Sz * Sz * 4);
  for (let y = 0; y < Sz; y++) for (let x = 0; x < Sz; x++) {
    const d = Math.hypot(x - 15.5, y - 15.5);
    const ring = Math.max(0, Math.min(1, 1.5 - Math.abs(d - 10) / 1.6));
    const dot = Math.max(0, Math.min(1, 4.5 - d));
    const i = (y * Sz + x) * 4;
    buf[i] = buf[i + 1] = buf[i + 2] = 255; buf[i + 3] = Math.round(Math.max(ring, dot) * 255);
  }
  return nativeImage.createFromBitmap(buf, { width: Sz, height: Sz }).resize({ width: 16, height: 16 });
}
function buildTray() {
  if (!tray) { tray = new Tray(makeTrayIcon()); tray.on('click', () => openSettings()); }
  tray.setToolTip('Lumen');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('menu.settings'), click: () => openSettings() },
    { label: t('menu.search'), click: toggleLauncher },
    { label: t('menu.toggleBar'), click: () => patch({ showMenubar: !S.showMenubar }) },
    { type: 'separator' },
    { label: t('menu.quit'), click: () => app.quit() },
  ]));
}

// ======================================================================
// IPC
// ======================================================================

const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a, e));
const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => fn(...a, e));

handle('get-settings', (a, b, c, e) => payload(isPrefsWin(BrowserWindow.fromWebContents(e.sender))));
on('update-settings', (p) => patch(p));
handle('i18n', () => I18N.dict(S.lang));

// Dock
handle('dock-icons', async () => {
  const out = {};
  for (const a of S.apps) {
    if (a.type === 'folder') { out[a.id] = null; continue; }
    const src = a.icon || a.iconSrc || (isUrlish(a.path) ? null : a.path);
    out[a.id] = a.icon ? await apps.icon(a.icon) : await apps.bestIcon({ exe: a.path, name: a.name, src });
  }
  return out;
});
handle('dock-state', () => ({ running: state.running, unpinned: state.unpinned, recycle: state.recycle }));
on('bar-mouse', (inside, e) => { const w = BrowserWindow.fromWebContents(e.sender); if (alive(w) && S.menubarAutoHide) w.setIgnoreMouseEvents(!inside, { forward: true }); });
on('dock-mouse', (inside) => { if (alive(W.dock)) W.dock.setIgnoreMouseEvents(!inside, { forward: true }); });
on('dock-click', async (kind, key, rect, e) => {
  if (kind === 'lumen') return openSettings();
  if (kind === 'launchpad') return hooks.launchpad && hooks.launchpad();
  if (kind === 'trash') return execFile('explorer.exe', ['shell:RecycleBinFolder']);
  if (kind === 'unpinned') { hidePopover(); return activateExe(key); }
  const a = S.apps.find(x => x.id === key);
  if (!a) return;
  if (a.type === 'folder') return showStack(a, rect, e);
  hidePopover();
  activateExe(itemExe(a), a.path);
});
on('dock-context', (kind, key, e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const items = [];
  if (kind === 'pinned') {
    const a = S.apps.find(x => x.id === key);
    const wins = a ? windowsForExe(itemExe(a)) : [];
    if (a) {
      items.push({ label: a.type === 'folder' ? t('dock.openFolder') : t('dock.newWindow'), click: () => launchPath(a.path) });
      if (wins.length) items.push({ label: t('dock.closeAll', { n: wins.length }), click: () => wins.forEach(w => fast.safe('close', { hwnd: w.hwnd })) });
      if (!isUrlish(a.path) && fs.existsSync(a.path)) items.push({ label: t('dock.showInFolder'), click: () => shell.showItemInFolder(a.path) });
      items.push({ label: t('dock.remove'), click: () => patch({ apps: S.apps.filter(x => x.id !== key) }) });
      items.push({ type: 'separator' });
    }
  } else if (kind === 'unpinned') {
    const u = state.unpinned.find(x => x.key === key);
    const wins = windowsForExe(key);
    if (u) {
      items.push({ label: t('dock.keep'), click: () => patch({ apps: [...S.apps, { id: uid(), type: 'app', name: u.name, path: u.exePath, exe: u.key }] }) });
      items.push({ label: t('dock.closeAll', { n: wins.length }), click: () => wins.forEach(w => fast.safe('close', { hwnd: w.hwnd })) });
      items.push({ type: 'separator' });
    }
  } else if (kind === 'trash') {
    items.push({ label: t('trash.open'), click: () => execFile('explorer.exe', ['shell:RecycleBinFolder']) });
    items.push({ label: t('trash.empty') + '…', enabled: state.recycle > 0, click: emptyTrash });
    items.push({ type: 'separator' });
  }
  items.push(
    { label: t('dock.autoHide'), type: 'checkbox', checked: S.dockAutoHide, click: (m) => patch({ dockAutoHide: m.checked }) },
    { label: t('dock.magnify'), type: 'checkbox', checked: S.dockMagnify, click: (m) => patch({ dockMagnify: m.checked }) },
    { label: t('dock.settings'), click: () => openSettings('dock') },
  );
  Menu.buildFromTemplate(items).popup({ window: win });
});
// Anteprime finestre al passaggio del mouse
let previewTimer = null, popHover = false;
on('dock-hover', (kind, key, rect, e) => {
  clearTimeout(previewTimer);
  if (!eff().dockPreviews || !kind || kind === 'lumen' || kind === 'trash' || kind === 'launchpad') {
    if (state.popoverMode === 'previews') previewTimer = setTimeout(() => { if (!popHover) hidePopover(); }, 250);
    return;
  }
  let exe = key;
  if (kind === 'pinned') { const a = S.apps.find(x => x.id === key); if (!a || a.type === 'folder') return; exe = itemExe(a); }
  const wins = windowsForExe(exe);
  if (!wins.length) { if (state.popoverMode === 'previews') hidePopover(); return; }
  previewTimer = setTimeout(() => showPreviews(exe, wins, rect, e), state.popoverMode === 'previews' ? 80 : 650);
});
async function showPreviews(exe, wins, rect, e) {
  if (state.popoverMode === 'stack') return;
  const win = BrowserWindow.fromWebContents(e.sender);
  const wb = win.getBounds();
  popAnchor = { x: wb.x + rect.x + rect.width / 2, y: wb.y + rect.y - 6 };
  state.popoverMode = 'previews';
  state.previewKey = exe;
  const ids = new Set(wins.map(w => `window:${w.hwnd}:0`));
  let sources = [];
  try { sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 280, height: 176 } }); } catch {}
  if (state.previewKey !== exe) return;
  const byId = new Map(sources.filter(s => ids.has(s.id)).map(s => [s.id, s.thumbnail.toDataURL()]));
  const items = wins.slice(0, 6).map(w => ({ hwnd: w.hwnd, title: w.title, thumb: byId.get(`window:${w.hwnd}:0`) || null, min: w.min }));
  const p = popover();
  send(p, 'popover', { mode: 'previews', items });
  if (!p.isVisible()) p.showInactive();
}
async function showStack(a, rect, e) {
  if (state.popoverMode === 'stack' && state.previewKey === a.id) return hidePopover();
  const win = BrowserWindow.fromWebContents(e.sender);
  const wb = win.getBounds();
  popAnchor = { x: wb.x + rect.x + rect.width / 2, y: wb.y + rect.y - 6 };
  let entries = [];
  try {
    entries = fs.readdirSync(a.path, { withFileTypes: true })
      .filter(d => !d.name.startsWith('.') && !/^desktop\.ini$/i.test(d.name))
      .map(d => { const p = path.join(a.path, d.name); let m = 0; try { m = fs.statSync(p).mtimeMs; } catch {} return { name: d.name, path: p, dir: d.isDirectory(), m }; })
      .sort((x, y) => y.m - x.m).slice(0, 24);
  } catch {}
  for (const en of entries) en.icon = await apps.icon(en.path);
  state.popoverMode = 'stack';
  state.previewKey = a.id;
  const p = popover();
  send(p, 'popover', { mode: 'stack', title: a.name, folder: a.path, items: entries });
  p.show(); p.focus();
}
on('popover-size', (w, h) => placePopover(w, h));
on('popover-hover', (inside) => {
  popHover = inside;
  if (!inside && state.popoverMode === 'previews') { clearTimeout(previewTimer); previewTimer = setTimeout(() => { if (!popHover) hidePopover(); }, 300); }
});
on('popover-focus', (hwnd) => { hidePopover(); fast.safe('focus', { hwnd }); });
on('popover-close-win', (hwnd) => { fast.safe('close', { hwnd }); setTimeout(pollWindows, 400); hidePopover(); });
on('popover-open', (p) => { hidePopover(); launchPath(p); });

// Barra dei menu
handle('bar-state', () => ({ fg: state.fg && { name: state.fg.name, exe: state.fg.exe }, pomo: state.pomo, stats: state.stats }));
on('bar-menu', (pos, e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  Menu.buildFromTemplate(logoMenuTemplate()).popup({ window: win, x: pos.x, y: pos.y });
});
on('bar-pomo-menu', (pos, e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  Menu.buildFromTemplate(state.pomo ? [
    { label: t('pomo.stop'), click: stopPomo },
    { label: t('pomo.restart'), click: () => startPomo(state.pomo.mode) },
  ] : [
    { label: t('pomo.startFocus', { m: S.focusMinutes }), click: () => startPomo('focus') },
    { label: t('pomo.startBreak', { m: S.breakMinutes }), click: () => startPomo('break') },
  ]).popup({ window: win, x: pos.x, y: pos.y });
});
on('toggle-control', (x, e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  toggleControl(win ? win.getBounds().x + x : undefined);
});
on('toggle-widgets', () => toggleWidgets());
on('open-settings', (tab) => (tab === '__welcome' ? openOnboarding() : openSettings(tab)));
on('quit', () => app.quit());

// Centro di controllo
handle('cc-state', async () => {
  const [vol, dark, dnd] = await Promise.all([fast.safe('volume', {}, null), fast.safe('darkMode', {}, null), fast.safe('dnd', {}, null)]);
  return { vol, dark, dnd, pomo: state.pomo };
});
let brightCache;
handle('cc-bright', async () => {
  if (brightCache === undefined) brightCache = await slow.safe('brightness', {}, null, 4000);
  else if (brightCache !== null) brightCache = await slow.safe('brightness', {}, brightCache, 4000);
  return brightCache; // null = schermo esterno senza controllo luminosità
});
handle('cc-radios', () => slow.safe('radios', {}, null, 6000));
handle('cc-media', () => slow.safe('media', {}, null, 4000));
on('cc-set', async (what, value) => {
  switch (what) {
    case 'volume': return fast.safe('setVolume', { level: value });
    case 'mute': return fast.safe('setMute', { muted: value });
    case 'brightness': return slow.safe('setBrightness', { level: Math.round(value) });
    case 'dark': await fast.safe('setDarkMode', { on: value }); return setTimeout(broadcast, 300);
    case 'dnd': return fast.safe('setDnd', { on: value });
    case 'wifi': return slow.safe('setRadio', { kind: 'WiFi', on: value }, null, 8000);
    case 'bluetooth': return slow.safe('setRadio', { kind: 'Bluetooth', on: value }, null, 8000);
    case 'media': return fast.safe('mediaKey', { key: value });
    case 'pomo': return value ? startPomo(value) : stopPomo();
    case 'desktop': if (alive(W.control)) W.control.hide(); return fast.safe('showDesktop');
    case 'lock': return POWER.lock();
    case 'snapshot': if (alive(W.control)) W.control.hide(); return shell.openExternal('ms-screenclip:');
  }
});
on('cc-size', (h) => { if (alive(W.control)) { const b = W.control.getBounds(); W.control.setBounds({ ...b, height: Math.round(h) }); } });

// Ricerca rapida
const COMMANDS = [
  { id: 'settings', glyph: 'gear', run: () => openSettings() },
  { id: 'lock', glyph: 'lock', run: POWER.lock },
  { id: 'sleep', glyph: 'moon', run: POWER.sleep },
  { id: 'restart', glyph: 'restart', run: POWER.restart },
  { id: 'shutdown', glyph: 'power', run: POWER.shutdown },
  { id: 'trash', glyph: 'trash', run: emptyTrash },
  { id: 'desktop', glyph: 'desktop', run: () => fast.safe('showDesktop') },
  { id: 'taskbar', glyph: 'layout', run: async () => { const h = await fast.safe('taskbar'); await fast.safe('setTaskbar', { hide: !h }); setTimeout(relayout, 600); } },
  { id: 'dark', glyph: 'contrast', run: async () => { const d = await fast.safe('darkMode'); await fast.safe('setDarkMode', { on: !d }); setTimeout(broadcast, 300); } },
  { id: 'dnd', glyph: 'bell', run: async () => { const d = await fast.safe('dnd'); fast.safe('setDnd', { on: !d }); } },
  { id: 'focus', glyph: 'timer', run: () => startPomo('focus') },
  { id: 'stopFocus', glyph: 'timer', run: stopPomo },
  { id: 'clipboard', glyph: 'clipboard', run: () => setTimeout(toggleClipboard, 120) },
  { id: 'widgets', glyph: 'widgets', run: toggleWidgets },
  { id: 'control', glyph: 'sliders', run: () => setTimeout(() => toggleControl(), 120) },
  { id: 'saveLayout', glyph: 'layout', run: () => openSettings('finestre') },
  { id: 'winSettings', glyph: 'gear', run: () => shell.openExternal('ms-settings:') },
  { id: 'quit', glyph: 'power', run: () => app.quit() },
];
handle('launcher-search', async (q) => {
  const ql = q.trim().toLowerCase();
  const found = apps.search(q, 7);
  const appRes = [];
  for (const a of found) appRes.push({ kind: 'app', name: a.name, path: a.path, icon: await apps.icon(a.iconSrc || a.path) });
  const cmdRes = [];
  if (ql) {
    for (const c of COMMANDS) {
      const name = t('cmd.' + c.id), kw = t('cmdk.' + c.id);
      if (name.toLowerCase().includes(ql) || kw.toLowerCase().split(',').some(k => k.trim() && (k.trim().startsWith(ql) || ql.startsWith(k.trim())))) {
        cmdRes.push({ kind: 'cmd', id: c.id, name, glyph: c.glyph });
      }
    }
    for (const l of S.layouts) {
      if (('layout ' + l.name).toLowerCase().includes(ql) || l.name.toLowerCase().startsWith(ql)) cmdRes.push({ kind: 'layout', id: l.id, name: t('layout.restoreNamed', { n: l.name }), glyph: 'layout' });
    }
  }
  const extra = [];
  for (const h of hooks.search) { try { extra.push(...(await h(q) || [])); } catch {} }
  return { apps: appRes, commands: cmdRes.slice(0, 5), extra };
});
handle('launcher-files', async (q) => {
  // Solo caratteri tipici dei nomi file: alcuni simboli bloccano l'indice di ricerca di Windows
  const clean = q.replace(/[^\p{L}\p{N} ._-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!S.launcherFiles || clean.length < 2) return [];
  const r = await slow.safe('searchFiles', { q: clean, n: 6 }, [], 6000) || [];
  for (const f of r) f.icon = await apps.icon(f.path, 'normal');
  return r;
});
handle('launcher-currency', (amount, from, to) => convertCurrency(amount, from, to).catch(() => null));
on('launcher-run', (item) => {
  if (alive(W.launcher)) W.launcher.hide();
  if (item.kind === 'app' || item.kind === 'file') launchPath(item.path);
  else if (item.kind === 'reveal') shell.showItemInFolder(item.path);
  else if (item.kind === 'url') shell.openExternal(item.url);
  else if (item.kind === 'cmd') { const c = COMMANDS.find(x => x.id === item.id); c && c.run(); }
  else if (item.kind === 'layout') restoreLayout(item.id);
  else if (hooks.run[item.kind]) hooks.run[item.kind](item);
});
on('launcher-pin', (item) => {
  if (S.apps.some(a => a.path === item.path)) return;
  const entry = apps.items.find(a => a.path === item.path) || {};
  patch({ apps: [...S.apps, { id: uid(), type: 'app', name: item.name, path: item.path, iconSrc: entry.iconSrc || undefined, exe: entry.exe || undefined }] });
});
on('launcher-hide', () => { if (alive(W.launcher)) W.launcher.hide(); });
on('launcher-height', (h) => { if (alive(W.launcher)) { const b = W.launcher.getBounds(); W.launcher.setBounds({ ...b, height: Math.round(h) }); } });

// Appunti
handle('clips', () => clips.items);
on('clip-use', async (id, paste) => {
  await clips.use(id);
  if (alive(W.clip)) W.clip.hide();
  if (paste && state.prevFg) {
    await fast.safe('focus', { hwnd: state.prevFg.hwnd });
    setTimeout(() => fast.safe('paste'), 90);
  }
});
on('clip-pin', (id) => clips.pin(id));
on('clip-remove', (id) => clips.remove(id));
on('clip-clear', async () => { if (await confirmBox(t('clip.clearQ'), t('clip.clearDetail'), t('clip.clear'))) clips.clear(); });
on('clip-hide', () => { if (alive(W.clip)) W.clip.hide(); });

// Widget
handle('widgets-state', () => ({ stats: state.stats, weather: state.weather }));
on('widgets-mouse', (inside) => { if (alive(W.widgets)) W.widgets.setIgnoreMouseEvents(!inside, { forward: true }); });
on('widgets-refresh-weather', () => refreshWeather());

// Impostazioni
handle('pick-apps', async () => {
  const r = await dialog.showOpenDialog(W.settings || W.onboarding, {
    title: t('apps.add'),
    defaultPath: path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: t('apps.filter'), extensions: ['exe', 'lnk', 'url'] }],
  });
  if (r.canceled) return null;
  return r.filePaths.map(p => ({ id: uid(), type: 'app', name: path.basename(p).replace(/\.(exe|lnk|url)$/i, ''), path: p }));
});
handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(W.settings, { properties: ['openDirectory'] });
  if (r.canceled) return null;
  const p = r.filePaths[0];
  return { id: uid(), type: 'folder', name: path.basename(p) || p, path: p };
});
handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(W.settings || W.onboarding, {
    properties: ['openFile'], filters: [{ name: t('common.images'), extensions: ['png', 'jpg', 'jpeg', 'bmp', 'ico', 'webp'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
handle('installed-apps', async () => {
  if (!apps.items.length) await apps.refresh();
  return apps.items.map(a => ({ name: a.name, path: a.path, iconSrc: a.iconSrc, exe: a.exe }));
});
handle('icon', (src) => apps.icon(src));
handle('shortcut-status', () => shortcutStatus);
handle('save-layout', (name) => saveLayout(name));
handle('restore-layout', (id) => restoreLayout(id));
handle('export-theme', async () => {
  const r = await dialog.showSaveDialog(W.settings, { defaultPath: 'tema.lumen-theme.json', filters: [{ name: 'Lumen', extensions: ['json'] }] });
  if (r.canceled) return false;
  const theme = Object.fromEntries(THEME_KEYS.map(k => [k, S[k]]));
  fs.writeFileSync(r.filePath, JSON.stringify({ lumenTheme: 1, ...theme }, null, 2));
  return true;
});
handle('import-theme', async () => {
  const r = await dialog.showOpenDialog(W.settings, { properties: ['openFile'], filters: [{ name: 'Lumen', extensions: ['json'] }] });
  if (r.canceled) return false;
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!data.lumenTheme) return false;
    patch(Object.fromEntries(THEME_KEYS.filter(k => k in data).map(k => [k, data[k]])));
    return true;
  } catch { return false; }
});
// Temi pronti. Un tema "skin" (es. Demoniaccio) porta con sé anche lo sfondo del desktop:
// lo sfondo che l'utente aveva prima viene ricordato e rimesso quando si torna a un tema normale.
function currentWindowsWallpaper() {
  return new Promise((res) => execFile('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], { windowsHide: true }, (err, out) => {
    const m = !err && /WallPaper\s+REG_SZ\s+(.+)/i.exec(out);
    res(m ? m[1].trim() : null);
  }));
}
handle('apply-preset', async (p) => {
  if (p.skin && p.skin !== 'default') {
    const src = path.join(__dirname, 'ui', 'skins', p.skin, 'wallpaper.jpg');
    const dest = path.join(app.getPath('userData'), `skin-${p.skin}-wallpaper.jpg`);
    fs.writeFileSync(dest, fs.readFileSync(src)); // fuori dall'asar, così Windows può leggerlo
    const prev = S.skin && S.skin !== 'default' ? S.prevWallpaper : ((S.wallpaperMode === 'static' && S.wallpaper) || await currentWindowsWallpaper());
    patch({ ...p.settings, skin: p.skin, prevWallpaper: prev || null, wallpaperMode: 'static', wallpaper: dest });
  } else {
    const back = S.skin && S.skin !== 'default' && S.prevWallpaper && fs.existsSync(S.prevWallpaper) ? { wallpaperMode: 'static', wallpaper: S.prevWallpaper } : {};
    patch({ ...p.settings, skin: 'default', prevWallpaper: null, ...back });
  }
  return true;
});

// Barra delle applicazioni di Windows: stessa opzione di Windows ("Nascondi automaticamente"), annullabile in ogni momento
handle('taskbar-get', () => fast.safe('taskbar', {}, null));
handle('taskbar-set', async (hide) => { await fast.safe('setTaskbar', { hide: !!hide }); setTimeout(relayout, 600); return fast.safe('taskbar', {}, null); });

handle('check-updates', () => checkUpdates(true));
handle('updater-available', () => updaterAvailable());
handle('memory', async () => {
  const m = await app.getAppMetrics();
  return m.reduce((s, p) => s + (p.memory ? p.memory.workingSetSize : 0), 0) * 1024;
});
// ======================================================================
// Prestazioni e pulizia
// ======================================================================

const isLumenStartup = (e) => /lumen|electron/i.test(e.name + ' ' + e.command);
const mb = (b) => (b / 1024 / 1024 >= 1024 ? (b / 1024 ** 3).toFixed(1) + ' GB' : Math.round(b / 1024 / 1024) + ' MB');

handle('perf-state', () => slow.safe('perf', {}, null, 15000));
handle('perf-startup', () => slow.safe('startup', {}, [], 15000));
handle('perf-procs', () => slow.safe('topProcs', { n: 8 }, [], 15000));
handle('perf-temp', () => slow.safe('cleanTemp', { dry: true }, { bytes: 0, count: 0 }, 60000));
handle('perf-backup', () => S.perfBackup || null);

// Salva lo stato originale solo la prima volta: "Ripristina" torna sempre a come era prima di Lumen.
async function ensureBackup(extraStartup = []) {
  const b = S.perfBackup ? JSON.parse(JSON.stringify(S.perfBackup)) : null;
  let backup = b;
  if (!backup) {
    const p = await slow.safe('perf', {}, null, 15000);
    if (!p) throw new Error('perf');
    backup = { at: Date.now(), animations: p.animations, transparency: p.transparency, background: p.background, tips: p.tips,
      power: p.power && p.power.active, liteMode: !!S.liteMode, dnd: await fast.safe('dnd', {}, null), startup: [] };
  }
  for (const s of extraStartup) if (!backup.startup.some(x => x.name === s.name && x.kind === s.kind)) backup.startup.push({ name: s.name, kind: s.kind });
  store.patch({ perfBackup: backup }); S = store.data;
}

handle('perf-set', async (key, value) => {
  await ensureBackup();
  if (key === 'liteMode') { patch({ liteMode: !!value }); return true; }
  return slow.safe('setPerf', { key, on: value }, false, 15000);
});
handle('startup-set', async (entry, enabled) => {
  if (!enabled) await ensureBackup([entry]);
  return slow.safe('setStartup', { name: entry.name, kind: entry.kind, enabled }, false, 15000);
});
handle('proc-kill', async (p) => {
  const ok = await confirmBox(t('perf.killQ', { n: p.label }), t('perf.killDetail'), t('perf.kill'));
  if (ok) await slow.safe('killProc', { name: p.name }, false, 15000);
  return ok;
});
handle('temp-clean', async () => {
  const dry = await slow.safe('cleanTemp', { dry: true }, { bytes: 0 }, 60000);
  if (!(await confirmBox(t('perf.tempQ', { s: mb(dry.bytes) }), t('perf.permanent'), t('perf.clean')))) return null;
  return slow.safe('cleanTemp', { dry: false }, { bytes: 0, count: 0 }, 120000);
});

// --- Pulizia in un clic ---
handle('oneclick-scan', async () => {
  const [temp, recycle, startup, bloat, perf] = await Promise.all([
    slow.safe('cleanTemp', { dry: true }, { bytes: 0, count: 0 }, 60000),
    fast.safe('recycleCount', {}, 0),
    slow.safe('startup', {}, [], 15000),
    slow.safe('bloat', {}, [], 60000),
    slow.safe('perf', {}, null, 15000),
  ]);
  const plans = (perf && perf.power && perf.power.list) || [];
  return {
    temp, recycle,
    startup: (startup || []).filter(e => e.editable && e.enabled && !isLumenStartup(e)),
    bloat: bloat || [],
    perf,
    highPlan: plans.some(p => p.id === '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'),
  };
});

handle('oneclick-run', async (choice) => {
  const res = { freed: 0, files: 0, recycle: false, startup: 0, bloat: [], tweaks: [] };
  const startupOff = choice.startup || [];
  await ensureBackup(startupOff);

  if (choice.temp) { const r = await slow.safe('cleanTemp', { dry: false }, null, 180000); if (r) { res.freed += r.bytes; res.files = r.count; } }
  if (choice.recycle) { await fast.safe('emptyRecycle', {}, null, 60000); res.recycle = true; refreshRecycle(); }
  for (const e of startupOff) { if (await slow.safe('setStartup', { name: e.name, kind: e.kind, enabled: false }, false, 15000)) res.startup++; }
  if (choice.bloat && choice.bloat.length) res.bloat = await slow.safe('removeBloat', { ids: choice.bloat }, [], 300000) || [];
  if (choice.tweaks) {
    for (const k of ['animations', 'transparency', 'background', 'tips']) { await slow.safe('setPerf', { key: k, on: false }, null, 15000); res.tweaks.push(k); }
    if (choice.highPlan) { await slow.safe('setPerf', { key: 'power', on: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' }, null, 15000); res.tweaks.push('power'); }
    patch({ liteMode: true }); res.tweaks.push('lite');
  }
  res.freedText = mb(res.freed);
  return res;
});

async function restorePerf() {
  const b = S.perfBackup;
  if (!b) return false;
  for (const k of ['animations', 'transparency', 'background', 'tips']) if (typeof b[k] === 'boolean') await slow.safe('setPerf', { key: k, on: b[k] }, null, 15000);
  if (b.power) await slow.safe('setPerf', { key: 'power', on: b.power }, null, 15000);
  for (const s of b.startup || []) await slow.safe('setStartup', { name: s.name, kind: s.kind, enabled: true }, null, 15000);
  if (typeof b.dnd === 'boolean') await fast.safe('setDnd', { on: b.dnd });
  store.patch({ perfBackup: null, activeProfile: null }); S = store.data;
  patch({ liteMode: !!b.liteMode });
  return true;
}
handle('perf-restore', () => restorePerf());

on('onboarding-done', () => { patch({ onboarded: true }); if (alive(W.onboarding)) W.onboarding.close(); });

// ======================================================================
// Avvio
// ======================================================================

app.whenReady().then(async () => {
  app.setAppUserModelId('app.lumen.desk');
  store = new Store(app.getPath('userData'));
  S = store.load();
  nativeTheme.themeSource = S.theme === 'auto' ? 'system' : S.theme;

  fast = new Helper('fast', app.getPath('userData')); fast.start();
  slow = new Helper('slow', app.getPath('userData')); slow.start();
  apps = new AppIndex(slow);
  clips = new ClipHistory(app.getPath('userData'), fast, () => S.clipboardMax, () => send(W.clip, 'clips', clips.items));
  clips.source = () => (state.fg && state.fg.name) || '';

  syncBars();
  createDock();
  syncWidgets();
  buildTray();
  registerShortcuts();
  if (S.clipboardEnabled) clips.start();

  let liteTick = 0; setInterval(() => { liteTick++; }, 900);
  setInterval(() => { if (!S.liteMode || liteTick % 2) pollForeground(); }, 900);
  setInterval(() => { if (!S.liteMode || liteTick % 3 === 0) pollWindows(); }, 1800);
  setInterval(pollCorners, 110);
  setInterval(refreshRecycle, 6000);
  setInterval(() => { { const E = eff(); if (E.menubarShowStats || (E.widgetsEnabled && E.widgets.system.on)) sampleStats(); } }, 2000);
  setInterval(refreshWeather, 20 * 60000);
  setInterval(() => applyWallpaper(false), 5 * 60000);
  // Dopo il primo elenco delle app il dock può usare le icone dei pacchetti dello Store
  setTimeout(() => apps.refresh().then(() => { lastWinSig = ''; send(W.dock, 'dock-icons-changed'); pollWindows(); }), 2500);
  setInterval(() => apps.refresh(), 15 * 60000);

  fast.ready.then(() => { pollWindows(); refreshRecycle(); applyWallpaper(false); });
  refreshWeather();
  if (S.autoUpdate) setTimeout(() => checkUpdates(false), 15000);
  if (!S.onboarded) setTimeout(openOnboarding, 800);

  nativeTheme.on('updated', broadcast);
  const onDisplays = () => setTimeout(relayout, 300);
  screen.on('display-metrics-changed', onDisplays);
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);

  // Modalità di verifica: LUMEN_SNAP=<cartella> apre tutto, salva gli screenshot ed esce
  // Funzioni aggiuntive (Mission Control, pannello laterale, profili, OBS, Quick Look, strumenti…)
  require('./features/more').install(ctx());
  require('./features/launchpad').install(ctx());
  registerShortcuts();

  if (process.env.LUMEN_SNAP) runSnapshots(process.env.LUMEN_SNAP);
});

// Punti di aggancio per i moduli aggiuntivi
const hooks = { shortcuts: [], search: [], run: {}, onPatch: [], mission: null, panel: null, launchpad: null };
function ctx() {
  return {
    get S() { return S; }, patch, store, fast, slow, W, state, hooks, apps, t, send, sendBars, alive, overlay, lazy, centerOn,
    rememberForeground, confirmBox, hwndOf, launchPath, relayout, primary, BAR_H, UI, PRELOAD, openSettings, broadcast,
    ensureBackup, restorePerf, mb, getJSON, windowsForExe, framedWindow, hostTitle,
  };
}

async function runSnapshots(dir) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const log = (s) => fs.appendFileSync(path.join(dir, 'steps.txt'), new Date().toISOString().slice(11, 19) + ' ' + s + '\n');
  const snap = async (name, w) => {
    log('snap ' + name);
    if (!alive(w)) return log('  (finestra assente)');
    const img = await Promise.race([w.webContents.capturePage(), wait(6000).then(() => null)]);
    if (img) fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG()); else log('  TIMEOUT cattura');
  };
  const memReport = async (label) => {
    const m = await app.getAppMetrics();
    const rows = m.map(p => `${p.type.padEnd(10)} ${String(Math.round((p.memory.privateBytes || p.memory.workingSetSize) / 1024)).padStart(5)} MB`);
    const tot = Math.round(m.reduce((s, p) => s + (p.memory.privateBytes || p.memory.workingSetSize), 0) / 1024);
    fs.appendFileSync(path.join(dir, 'memory.txt'), `== ${label}: ${tot} MB (privata)\n${rows.join('\n')}\n`);
  };
  if (process.env.LUMEN_SNAP_ONLY === 'dockicons') {
    await fast.ready; await wait(14000);
    log('app=' + apps.items.length + ' non fissate=' + state.unpinned.map(u => u.name).join(', '));
    await snap('dock', W.dock);
    return app.quit();
  }
  if (process.env.LUMEN_SNAP_ONLY === 'fullscreen') {
    await fast.ready; await wait(4000);
    const st = (label) => log(`${label}: fullscreen=${state.fullscreen} barVisibile=${[...W.bars.values()].map(w => w.isVisible()).join('/')} dockVisibile=${W.dock.isVisible()} app="${state.fg && state.fg.name}" area=${JSON.stringify(primary().workArea)}`);
    st('prima');
    for (const mode of ['zoom', 'fs']) {
      const py = require('child_process').spawn('python', [process.env.LUMEN_FS_PY, mode], { stdio: 'ignore' });
      await wait(2500);
      const pw = (await fast.safe('windows', { exclude: process.pid }, []) || []).find(x => x.title === 'DEMONIACCI-OS');
      if (pw) await fast.safe('focus', { hwnd: pw.hwnd });
      await wait(2000); st(mode + ' aperta');
      await new Promise(r => py.on('exit', r)); await wait(2500); st(mode + ' chiusa');
    }
    return app.quit();
  }
  if (process.env.LUMEN_SNAP_ONLY === 'launchpad') {
    await fast.ready; await wait(3000);
    const t0 = Date.now();
    await hooks.launchpad();
    log('launchpad aperto in ' + (Date.now() - t0) + ' ms, app=' + apps.items.length);
    for (const ms of [1000, 3000, 8000, 16000]) { await wait({1000: 1000, 3000: 2000, 8000: 5000, 16000: 8000}[ms]); log(ms + 'ms icone ricevute=' + await W.launchpad.webContents.executeJavaScript('Object.keys(icons).length')); }
    log('tessere=' + await W.launchpad.webContents.executeJavaScript("document.querySelectorAll('.app').length + ' icone=' + document.querySelectorAll('.app img').length + ' pagine=' + document.querySelectorAll('.page').length"));
    await snap('launchpad', W.launchpad);
    await W.launchpad.webContents.executeJavaScript("(() => { const q = document.getElementById('q'); q.value = 'note'; q.dispatchEvent(new Event('input')); })()");
    await wait(400); await snap('launchpad-search', W.launchpad);
    W.launchpad.hide(); await snap('dock', W.dock);
    return app.quit();
  }
  if (process.env.LUMEN_SNAP_ONLY === 'fix') {
    await fast.ready; await wait(4500);
    log('area di lavoro con Lumen: ' + JSON.stringify(primary().workArea) + ' dockReservedH=' + dockReservedH + ' dock=' + JSON.stringify(W.dock.getBounds()));
    await snap('dock', W.dock);
    openSettings('dock'); await wait(1500); broadcast(); await wait(800); await snap('settings', W.settings);
    return app.quit();
  }
  if (process.env.LUMEN_SNAP_ONLY === 'disk') {
    // Solo lettura: panoramica (calcolo senza cancellare) ed esplorazione
    await fast.ready; hooks.disk(); await wait(9000);
    const dw = BrowserWindow.getAllWindows().find(w => /disk\.html$/.test(w.webContents.getURL()));
    await snap('disk-over', dw);
    await dw.webContents.executeJavaScript("document.querySelector('[data-tab=explore]').click()"); await wait(5000); await snap('disk-explore', dw);
    await dw.webContents.executeJavaScript("document.querySelector('[data-tab=clean]').click()"); await wait(4000); await snap('disk-clean', dw);
    return app.quit();
  }
  if (process.env.LUMEN_SNAP_ONLY === 'v21') {
    // Solo lettura: apre le nuove finestre e le fotografa, senza cambiare impostazioni
    await fast.ready; await wait(3500);
    await hooks.mission();
    for (const ev of ['show', 'hide', 'blur', 'focus']) W.mission.on(ev, () => log('mission evento: ' + ev));
    log('dopo mission(): visibile=' + W.mission.isVisible());
    await wait(2500);
    log('mission visibile=' + W.mission.isVisible() + ' finestre=' + await W.mission.webContents.executeJavaScript("document.querySelectorAll('.win').length + ' miniature=' + document.querySelectorAll('.shot[style*=data]').length"));
    await snap('mission', W.mission); W.mission.hide();
    if (process.env.LUMEN_SNAP_STOP) return app.quit();
    hooks.panel(); await wait(2500); await snap('panel', W.panel); W.panel.hide();
    toggleControl(); await wait(2500); await snap('control', W.control); W.control.hide();
    for (const tab of ['profili', 'strumenti', 'snippet']) { openSettings(tab); await wait(1800); await snap('settings-' + tab, W.settings); }
    await toggleLauncher(); await wait(500); W.launcher.webContents.send('launcher-test', 'mission'); await wait(1500); await snap('launcher', W.launcher); W.launcher.hide();
    log('desktops: ' + JSON.stringify(await fast.safe('desktops')));
    return app.quit();
  }
  if (process.env.LUMEN_SNAP_ONLY === 'skin') {
    // Solo in memoria: niente salvataggio, sfondo del desktop invariato
    S.skin = 'demoniaccio'; S.theme = 'dark'; S.showMenubar = true; syncBars(); broadcast();
    await fast.ready; await wait(3500);
    await snap('dock', W.dock); await snap('bar', [...W.bars.values()][0]); await snap('widgets', W.widgets);
    openSettings('aspetto'); await wait(2500); await snap('settings', W.settings);
    await toggleLauncher(); await wait(600); W.launcher.webContents.send('launcher-test', 'disc'); await wait(1500); await snap('launcher', W.launcher); W.launcher.hide();
    toggleControl(); await wait(2000); await snap('control', W.control);
    return app.quit();
  }
  if (process.env.LUMEN_SNAP_ONLY === 'perf') {
    // Solo lettura: apre la sezione e l'analisi, non preme mai "Esegui"
    await fast.ready; openSettings('prestazioni'); await wait(6000); await snap('perf', W.settings);
    await W.settings.webContents.executeJavaScript("document.getElementById('oneClick').click()");
    await wait(9000); await snap('perf-oneclick', W.settings);
    return app.quit();
  }
  // Solo in memoria (non salvato): mostra la barra per poterla fotografare anche se l'utente l'ha nascosta
  if (!S.showMenubar) { S.showMenubar = true; syncBars(); }
  await fast.ready; await wait(3500);
  await memReport('a riposo');
  await snap('dock', W.dock); await snap('bar', [...W.bars.values()][0]); await snap('widgets', W.widgets);
  openSettings(); await wait(1800); await snap('settings', W.settings);
  for (const tab of (process.env.LUMEN_SNAP_TABS || '').split(',').filter(Boolean)) { send(W.settings, 'tab', tab); await wait(700); await snap('settings-' + tab, W.settings); }
  await toggleLauncher(); await wait(800);
  W.launcher.webContents.send('launcher-test', process.env.LUMEN_SNAP_QUERY || 'calc'); await wait(2500); await snap('launcher', W.launcher);
  W.launcher.webContents.send('launcher-test', '12*(3+4)^2'); await wait(600); await snap('launcher-calc', W.launcher);
  W.launcher.webContents.send('launcher-test', '50 eur in usd'); await wait(2500); await snap('launcher-currency', W.launcher);
  W.launcher.webContents.send('launcher-test', 'blocca'); await wait(900); await snap('launcher-cmd', W.launcher);
  W.launcher.hide();

  // Appunti: copia un testo di prova, verifica la cattura, poi ripristina tutto
  const { clipboard } = require('electron');
  const oldText = await clipboard.readText().catch(() => '');
  const before = clips.items.length;
  const probe = 'Lumen test ' + Date.now();
  await clipboard.writeText(probe);
  await wait(1800);
  const got = clips.items[0] && clips.items[0].text === probe;
  log(`clipboard: catturato=${got}`);
  await toggleClipboard(); await wait(900); await snap('clipboard', W.clip); W.clip.hide();
  if (got) clips.remove(clips.items[0].id);
  if (oldText) { await clipboard.writeText(oldText); await wait(1000); if (clips.items[0] && clips.items[0].text === oldText && clips.items.length > before) clips.remove(clips.items[0].id); }

  // Dock: cartella a ventaglio e anteprime finestre
  const db = W.dock.getBounds();
  const fakeE = { sender: W.dock.webContents };
  await showStack({ id: 'test', name: 'Download', path: app.getPath('downloads') }, { x: db.width / 2, y: 20, width: 50, height: 50 }, fakeE);
  await wait(1200); await snap('stack', W.popover); hidePopover();
  const target = state.windows.find(w => !w.min);
  if (target) {
    const exe = path.basename(target.exe).toLowerCase();
    await showPreviews(exe, windowsForExe(exe), { x: db.width / 2, y: 20, width: 50, height: 50 }, fakeE);
    await wait(1500); await snap('previews', W.popover); hidePopover();
  }
  log('finestre trovate: ' + state.windows.length + ', non fissate nel dock: ' + state.unpinned.map(u => u.name).join(', '));
  toggleControl(); await wait(2500); await snap('control', W.control); W.control.hide();
  openOnboarding(); await wait(1500); await snap('onboarding', W.onboarding);
  await memReport('tutto aperto');
  app.quit();
}

app.on('second-instance', () => openSettings());
app.on('window-all-closed', (e) => e.preventDefault?.());
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  const hwnds = [...W.bars.values(), W.dock].filter(alive).map(hwndOf);
  await Promise.race([fast.safe('appBarRemove', { hwnds }), new Promise(r => setTimeout(r, 1500))]);
  fast.stop(); slow.stop();
  app.quit();
});
