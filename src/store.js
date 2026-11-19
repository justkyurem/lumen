const fs = require('fs');
const path = require('path');

const sys = (p) => path.join(process.env.SystemRoot || 'C:\\Windows', p);

const DEFAULT_APPS = [
  { name: 'Esplora file', path: sys('explorer.exe') },
  { name: 'Edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
  { name: 'Blocco note', path: sys('System32\\notepad.exe') },
  { name: 'Calcolatrice', path: sys('System32\\calc.exe') },
  { name: 'Impostazioni', path: 'ms-settings:', glyph: 'gear' },
];

const DEFAULTS = {
  lang: 'it',
  onboarded: false,

  // Aspetto
  theme: 'auto',
  accent: '#0a84ff',
  skin: 'default',
  prevWallpaper: null,

  // Dock
  dockSize: 52,
  dockMagnify: true,
  dockMagnifyScale: 1.55,
  dockAutoHide: false,
  dockShowRunning: true,
  dockShowUnpinned: true,
  dockPreviews: true,
  dockShowTrash: true,
  dockShowLaunchpad: true,
  apps: [],

  // Barra dei menu
  showMenubar: true,
  menubarAllDisplays: true,
  menubarReserve: true,
  menubarAutoHide: false,
  dockReserve: true,
  menubarShowActiveApp: true,
  menubarLabel: 'Desktop',
  menubarShowStats: false,
  clock24: true,
  showSeconds: false,
  showDate: true,
  showBattery: true,

  // Ricerca rapida
  launcherEnabled: true,
  launcherShortcut: 'Alt+Space',
  launcherFiles: true,
  launcherWeb: 'google',

  // Appunti
  clipboardEnabled: true,
  clipboardShortcut: 'Ctrl+Shift+V',
  clipboardMax: 100,

  // Angoli attivi: none | launcher | control | desktop | lock | widgets | clipboard | settings
  hotCorners: { tl: 'none', tr: 'control', bl: 'none', br: 'desktop' },

  // Finestre
  snapEnabled: true,
  layouts: [],

  // Concentrazione
  focusMinutes: 25,
  breakMinutes: 5,

  // Widget
  widgetsEnabled: true,
  widgets: {
    clock:    { on: true,  x: 40,  y: 40 },
    weather:  { on: true,  x: 40,  y: 230 },
    calendar: { on: true,  x: 40,  y: 400 },
    notes:    { on: false, x: 330, y: 40 },
    system:   { on: false, x: 330, y: 260 },
  },
  weatherCity: '',
  notes: '',
  events: [],

  // Sfondo
  wallpaperMode: 'static',
  wallpaper: '',
  dynamicWallpapers: { dawn: '', day: '', dusk: '', night: '' },

  // Prestazioni
  liteMode: false,
  perfBackup: null,
  autoClean: false,
  autoCleanRecycle: false,
  lastAutoClean: 0,
  alertsEnabled: true,

  // Mission Control, desktop virtuali, strumenti
  missionShortcut: 'Alt+W',
  quickLookShortcut: 'Alt+Q',
  pickerShortcut: 'Ctrl+Alt+P',
  launchpadShortcut: 'Alt+A',
  launchpadHidden: [],
  showDesktops: true,
  desktopWallpapers: {},
  colors: [],

  // Profili e OBS
  activeProfile: null,
  liveApps: [],
  obsEnabled: false,
  obsHost: 'localhost',
  obsPort: 4455,
  obsPassword: '',

  // Snippet e ricerca nel browser
  snippetsEnabled: false,
  snippets: [{ trigger: ';ciao', text: 'Ciao! Come va?' }],
  launcherBrowser: false,

  // Generale
  launchAtLogin: false,
  autoUpdate: true,
};

// Chiavi oggetto da unire in profondità (un livello)
const NESTED = ['hotCorners', 'widgets', 'dynamicWallpapers', 'desktopWallpapers'];

function uid() { return Math.random().toString(36).slice(2, 10); }

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = null;
  }

  load() {
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    const d = { ...DEFAULTS, ...(saved || {}) };
    for (const k of NESTED) d[k] = mergeNested(DEFAULTS[k], saved && saved[k]);
    if (!saved) {
      d.apps = DEFAULT_APPS
        .filter(a => a.path.endsWith(':') || fs.existsSync(a.path))
        .map(a => ({ id: uid(), type: 'app', ...a }));
    } else {
      // Utente della v1: niente onboarding forzato
      if (saved.onboarded === undefined) d.onboarded = true;
      d.apps = (d.apps || []).map(a => ({ type: 'app', ...a }));
    }
    this.data = d;
    this.save();
    return d;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  patch(p) {
    for (const [k, v] of Object.entries(p)) {
      this.data[k] = NESTED.includes(k) ? mergeNested(this.data[k], v) : v;
    }
    this.save();
  }
}

function mergeNested(base, over) {
  const out = JSON.parse(JSON.stringify(base || {}));
  if (!over) return out;
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? { ...out[k], ...v } : v;
  }
  return out;
}

// Chiavi che compongono un "tema" esportabile
const THEME_KEYS = ['theme', 'accent', 'skin', 'dockSize', 'dockMagnify', 'dockMagnifyScale', 'dockAutoHide', 'dockShowTrash', 'dockShowLaunchpad',
  'showMenubar', 'menubarShowActiveApp', 'menubarLabel', 'clock24', 'showSeconds', 'showDate', 'showBattery', 'menubarShowStats',
  'widgetsEnabled', 'widgets', 'wallpaperMode', 'wallpaper', 'dynamicWallpapers'];

module.exports = { Store, DEFAULTS, THEME_KEYS, uid };
