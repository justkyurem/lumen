const { contextBridge, ipcRenderer } = require('electron');

// Ogni funzione passa sempre lo stesso numero di argomenti: il main li legge per posizione.
const inv = (ch) => (a = null, b = null, c = null) => ipcRenderer.invoke(ch, a, b, c);
const snd = (ch) => (a = null, b = null, c = null) => ipcRenderer.send(ch, a, b, c);

contextBridge.exposeInMainWorld('lumen', {
  on: (ch, cb) => ipcRenderer.on(ch, (_e, data) => cb(data)),

  getSettings: inv('get-settings'),
  update: (patch) => ipcRenderer.send('update-settings', patch),
  i18n: inv('i18n'),
  openSettings: (tab = null) => ipcRenderer.send('open-settings', tab),
  quit: () => ipcRenderer.send('quit'),

  // Dock
  dockIcons: inv('dock-icons'),
  dockState: inv('dock-state'),
  dockMouse: (inside) => ipcRenderer.send('dock-mouse', inside),
  dockClick: (kind, key, rect) => ipcRenderer.send('dock-click', kind, key, rect),
  dockContext: (kind, key) => ipcRenderer.send('dock-context', kind, key),
  dockHover: (kind, key, rect) => ipcRenderer.send('dock-hover', kind, key, rect),

  // Popover
  popoverSize: (w, h) => ipcRenderer.send('popover-size', w, h),
  popoverHover: (inside) => ipcRenderer.send('popover-hover', inside),
  popoverFocus: (hwnd) => ipcRenderer.send('popover-focus', hwnd),
  popoverCloseWin: (hwnd) => ipcRenderer.send('popover-close-win', hwnd),
  popoverOpen: (p) => ipcRenderer.send('popover-open', p),

  // Barra
  barState: inv('bar-state'),
  barMouse: (inside) => ipcRenderer.send('bar-mouse', !!inside),
  barMenu: (pos) => ipcRenderer.send('bar-menu', pos),
  pomoMenu: (pos) => ipcRenderer.send('bar-pomo-menu', pos),
  toggleControl: (x) => ipcRenderer.send('toggle-control', x),
  toggleWidgets: () => ipcRenderer.send('toggle-widgets'),

  // Centro di controllo
  ccState: inv('cc-state'),
  ccRadios: inv('cc-radios'),
  ccBright: inv('cc-bright'),
  ccMedia: inv('cc-media'),
  ccSet: (what, value = null) => ipcRenderer.send('cc-set', what, value),
  ccSize: (h) => ipcRenderer.send('cc-size', h),

  // Ricerca rapida
  search: inv('launcher-search'),
  searchFiles: inv('launcher-files'),
  currency: (amount, from, to) => ipcRenderer.invoke('launcher-currency', amount, from, to),
  run: (item) => ipcRenderer.send('launcher-run', item),
  pin: (item) => ipcRenderer.send('launcher-pin', item),
  hideLauncher: () => ipcRenderer.send('launcher-hide'),
  launcherHeight: (h) => ipcRenderer.send('launcher-height', h),

  // Appunti
  clips: inv('clips'),
  clipUse: (id, paste) => ipcRenderer.send('clip-use', id, !!paste),
  clipPin: (id) => ipcRenderer.send('clip-pin', id),
  clipRemove: (id) => ipcRenderer.send('clip-remove', id),
  clipClear: () => ipcRenderer.send('clip-clear'),
  clipHide: () => ipcRenderer.send('clip-hide'),

  // Widget
  widgetsState: inv('widgets-state'),
  widgetsMouse: (inside) => ipcRenderer.send('widgets-mouse', inside),
  refreshWeather: () => ipcRenderer.send('widgets-refresh-weather'),

  // Impostazioni
  pickApps: inv('pick-apps'),
  pickFolder: inv('pick-folder'),
  pickImage: inv('pick-image'),
  installedApps: inv('installed-apps'),
  icon: inv('icon'),
  shortcutStatus: inv('shortcut-status'),
  saveLayout: inv('save-layout'),
  restoreLayout: inv('restore-layout'),
  applyPreset: inv('apply-preset'),
  taskbarGet: inv('taskbar-get'),
  taskbarSet: inv('taskbar-set'),
  exportTheme: inv('export-theme'),
  importTheme: inv('import-theme'),
  checkUpdates: inv('check-updates'),
  updaterAvailable: inv('updater-available'),
  memory: inv('memory'),
  onboardingDone: () => ipcRenderer.send('onboarding-done'),

  // Mission Control, pannello, desktop
  missionFocus: (hwnd) => ipcRenderer.send('mission-focus', hwnd),
  missionCloseWin: (hwnd) => ipcRenderer.send('mission-close-win', hwnd),
  missionDesktop: (i) => ipcRenderer.send('mission-desktop', i),
  missionNewDesktop: () => ipcRenderer.send('mission-new-desktop'),
  missionHide: () => ipcRenderer.send('mission-hide'),
  launchpadOpen: (name) => ipcRenderer.send('launchpad-open', name),
  launchpadHide: () => ipcRenderer.send('launchpad-hide'),
  launchpadContext: (name) => ipcRenderer.send('launchpad-context', name),
  launchpadRefresh: () => ipcRenderer.send('launchpad-refresh'),
  togglePanel: () => ipcRenderer.send('toggle-panel'),
  panelWinNotifications: () => ipcRenderer.send('panel-win-notifications'),
  panelMedia: inv('panel-media'),
  desktopsGet: inv('desktops-get'),
  barDesktop: (i) => ipcRenderer.send('bar-desktop', i),
  barDesktopMenu: (pos) => ipcRenderer.send('bar-desktop-menu', pos),

  // Profili, OBS
  profileApply: inv('profile-apply'),
  obsStatus: inv('obs-status'),
  obsAction: (a, arg = null) => ipcRenderer.invoke('obs-action', a, arg),

  // Quick Look, selettore colore, strumenti
  qlOpen: (p) => ipcRenderer.send('ql-open', p),
  qlReveal: (p) => ipcRenderer.send('ql-reveal', p),
  qlHide: () => ipcRenderer.send('ql-hide'),
  pickerDone: (hex) => ipcRenderer.send('picker-done', hex),
  pickerStart: () => ipcRenderer.send('picker-start'),
  toolsPick: inv('tools-pick'),
  toolsRename: inv('tools-rename'),
  toolsRenameUndo: inv('tools-rename-undo'),
  toolsConvertSave: (input, ext, bytes) => ipcRenderer.invoke('tools-convert-save', input, ext, bytes),
  toolsReveal: (p) => ipcRenderer.send('tools-reveal', p),

  // Analisi disco (PuliDisco)
  disk: {
    openWindow: inv('disk-open-window'),
    home: inv('disk-home'),
    admin: inv('disk-admin'),
    drives: inv('disk-drives'),
    children: inv('disk-children'),
    top: inv('disk-top'),
    targets: inv('disk-targets'),
    dev: inv('disk-dev'),
    pickFolder: inv('disk-pick-folder'),
    reveal: inv('disk-reveal'),
    openPath: inv('disk-open-path'),
    clean: inv('disk-clean'),
    devClean: inv('disk-dev-clean'),
    trash: inv('disk-trash'),
    report: inv('disk-report'),
    classic: inv('disk-classic'),
  },

  // Prestazioni
  perfState: inv('perf-state'),
  perfStartup: inv('perf-startup'),
  perfProcs: inv('perf-procs'),
  perfTemp: inv('perf-temp'),
  perfBackup: inv('perf-backup'),
  perfSet: (key, value) => ipcRenderer.invoke('perf-set', key, value),
  startupSet: (entry, enabled) => ipcRenderer.invoke('startup-set', entry, enabled),
  procKill: inv('proc-kill'),
  tempClean: inv('temp-clean'),
  oneClickScan: inv('oneclick-scan'),
  oneClickRun: inv('oneclick-run'),
  perfRestore: inv('perf-restore'),
});
