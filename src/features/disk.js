// Analisi disco (motore di PuliDisco): finestra, comandi e conferme.
// Regole: niente viene cancellato senza conferma; i file grandi vanno nel Cestino (recuperabili);
// le voci che richiedono amministratore vengono saltate.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Helper } = require('../native/helper');

exports.install = (c) => {
  const { t } = c;
  const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a, e));
  let engine = null, win = null;

  const disk = () => {
    if (!engine) { engine = new Helper('disk', app.getPath('userData'), 'disk.ps1'); engine.start(); }
    return engine;
  };
  const call = (cmd, args, fallback, timeout = 300000) => disk().safe(cmd, args, fallback, timeout);
  const size = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + ' GB' : b >= 1024 ** 2 ? (b / 1024 ** 2).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
  const ask = async (message, detail, ok) => (await dialog.showMessageBox(win, { type: 'warning', message, detail, buttons: [ok, t('common.cancel')], defaultId: 1, cancelId: 1 })).response === 0;

  function open() {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
    win = c.framedWindow('disk.html', { width: 1000, height: 700, minWidth: 820, minHeight: 560, title: t('disk.title') });
    win.on('closed', () => { win = null; if (engine) { engine.stop(); engine = null; } }); // libera la memoria quando chiudi
  }
  c.hooks.disk = open;

  handle('disk-open-window', () => open());
  handle('disk-home', () => process.env.USERPROFILE || 'C:\\');
  handle('disk-admin', () => call('admin', {}, false, 30000));
  handle('disk-drives', () => call('drives', {}, []));
  handle('disk-children', (p) => call('children', { path: p }, []));
  handle('disk-top', (p) => call('topFiles', { path: p, count: 40, minBytes: 50 * 1024 * 1024 }, []));
  handle('disk-targets', () => call('targets', {}, []));
  handle('disk-dev', (p) => call('devDirs', { path: p }, []));
  handle('disk-pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('disk-reveal', (p) => shell.showItemInFolder(p));
  handle('disk-open-path', (p) => shell.openPath(p));

  // Pulizia cache/temp: conferma con l'elenco e il totale
  handle('disk-clean', async (items) => {
    if (!items || !items.length) return null;
    const total = items.reduce((s, x) => s + (x.bytes || 0), 0);
    const list = items.map(x => `• ${x.name} (${size(x.bytes || 0)})`).join('\n');
    if (!(await ask(t('disk.cleanQ', { s: size(total) }), list + '\n\n' + t('disk.permanent'), t('disk.clean')))) return null;
    return call('clean', { names: items.map(x => x.name) }, []);
  });

  // Cartelle di sviluppo rigenerabili
  handle('disk-dev-clean', async (items) => {
    if (!items || !items.length) return null;
    const total = items.reduce((s, x) => s + (x.bytes || 0), 0);
    const list = items.slice(0, 15).map(x => `• ${x.path}`).join('\n') + (items.length > 15 ? `\n… +${items.length - 15}` : '');
    if (!(await ask(t('disk.devQ', { n: items.length, s: size(total) }), list + '\n\n' + t('disk.devDetail'), t('disk.delete')))) return null;
    return call('devClean', { paths: items.map(x => x.path) }, []);
  });

  // File grandi: solo nel Cestino, così si possono recuperare
  handle('disk-trash', async (items) => {
    if (!items || !items.length) return null;
    const total = items.reduce((s, x) => s + (x.bytes || 0), 0);
    if (!(await ask(t('disk.trashQ', { n: items.length, s: size(total) }), items.map(x => `• ${x.path}`).join('\n') + '\n\n' + t('disk.trashDetail'), t('disk.toTrash')))) return null;
    const done = [];
    for (const x of items) { try { await shell.trashItem(x.path); done.push(x.path); } catch {} }
    return done;
  });

  // Report HTML (stesso report di PuliDisco)
  handle('disk-report', async (p) => {
    const dir = path.join(app.getPath('userData'), 'reports');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const out = path.join(dir, `PuliDisco-report-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.html`);
    const r = await call('report', { path: p, out }, null, 900000);
    if (r && fs.existsSync(out)) { shell.openPath(out); return out; }
    return null;
  });

  // PuliDisco classico (menu nel terminale), per chi lo preferisce
  handle('disk-classic', () => {
    const dest = path.join(app.getPath('userData'), 'PuliDisco.ps1');
    fs.writeFileSync(dest, fs.readFileSync(path.join(__dirname, '..', 'native', 'PuliDisco.ps1')));
    spawn('cmd.exe', ['/c', 'start', 'PuliDisco', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', dest], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  });
};
