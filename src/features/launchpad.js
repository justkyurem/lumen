// Launchpad: tutte le app installate in una griglia a schermo intero, con ricerca e pagine.
const { ipcMain, screen, shell, Menu, BrowserWindow } = require('electron');
const fs = require('fs');

exports.install = (c) => {
  const { W, hooks, send, alive, t } = c;
  const S = () => c.S;
  const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => fn(...a, e));
  let refreshing = null;

  // Manuali, guide, siti web e disinstallatori non sono app: restano cercabili nella ricerca rapida
  const JUNK = /\b(manual|manuale|readme|leggimi|help|guida|documentation|documentazione|license|licenza|website|sito web|release notes|installation notes|note sulla versione|uninstall|disinstalla|about java)\b/i;
  const DOC = /\.(pdf|chm|txt|rtf|html?|url|md|docx?)$/i;
  const junkCache = new Map();
  const isJunk = (a) => {
    if (junkCache.has(a.path)) return junkCache.get(a.path);
    let j = JUNK.test(a.name);
    if (!j && /\.lnk$/i.test(a.path || '')) { try { j = DOC.test(shell.readShortcutLink(a.path).target || ''); } catch {} }
    if (!j && /\.url$/i.test(a.path || '')) { try { j = /^URL=https?:/im.test(fs.readFileSync(a.path, 'utf8')); } catch {} }
    junkCache.set(a.path, j);
    return j;
  };
  const visibleApps = () => {
    const hidden = new Set(S().launchpadHidden || []);
    return c.apps.items
      .filter(a => !hidden.has(a.name) && !isJunk(a))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  };

  // Icone: quelle di Windows (funzionano anche per le app dello Store) a gruppi dal processo nativo,
  // poi, per chi non ha un ID app, l'icona del file. Tutto resta in memoria per le aperture successive.
  const lpIcons = new Map();
  const fileIcon = (a) => {
    const src = a.iconSrc || (a.path && !/^shell:/i.test(a.path) ? a.path : null);
    // Alcuni collegamenti fanno attendere Windows a lungo: dopo 1,5 s si passa oltre
    return src ? Promise.race([c.apps.icon(src), new Promise(r => setTimeout(() => r(null), 1500))]) : Promise.resolve(null);
  };

  async function loadIcons(list, onBatch, stillWanted = () => true) {
    const todo = list.filter(a => !lpIcons.has(a.name));
    const withId = todo.filter(a => a.appId), noId = todo.filter(a => !a.appId);
    for (let i = 0; i < withId.length && stillWanted(); i += 40) {
      const chunk = withId.slice(i, i + 40);
      const r = await c.slow.safe('appIcons', { ids: chunk.map(a => a.appId), size: 64 }, {}, 30000) || {};
      const out = {};
      for (const a of chunk) {
        const ic = r[a.appId] || await fileIcon(a);
        lpIcons.set(a.name, ic || null);
        if (ic) out[a.name] = ic;
      }
      onBatch(out);
    }
    for (const a of noId) {
      if (!stillWanted()) return;
      const ic = await fileIcon(a);
      lpIcons.set(a.name, ic || null);
      if (ic) onBatch({ [a.name]: ic });
    }
  }

  // Precarica le icone con calma dopo l'avvio, così il Launchpad si apre già completo
  setTimeout(() => { if (c.apps.items.length) loadIcons(visibleApps(), () => {}); }, 40 * 1000);

  async function launchpad() {
    const w = c.lazy('launchpad', 'launchpad.html', { width: 800, height: 600, focusable: true }, (w) => {
      w.on('blur', () => { if (Date.now() - (w._shownAt || 0) > 600) w.hide(); else setTimeout(() => { if (alive(w) && w.isVisible()) w.focus(); }, 50); });
    });
    if (w.isVisible()) return w.hide();
    c.rememberForeground && c.rememberForeground();
    if (!c.apps.items.length) { refreshing = refreshing || c.apps.refresh().finally(() => { refreshing = null; }); await refreshing; }
    const list = visibleApps();
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    w.setBounds(d.bounds);
    w._shownAt = Date.now();
    w.show(); w.moveTop(); w.focus();
    // Le icone già pronte partono subito, le altre a seguire
    const cached = {};
    for (const a of list) if (lpIcons.get(a.name)) cached[a.name] = lpIcons.get(a.name);
    send(w, 'launchpad', { apps: list.map(a => ({ name: a.name })), icons: cached });
    loadIcons(list, (batch) => send(w, 'launchpad-icons', batch), () => alive(w) && w.isVisible());
  }
  hooks.launchpad = launchpad;

  const hide = () => { if (alive(W.launchpad)) W.launchpad.hide(); };
  const find = (name) => c.apps.items.find(a => a.name === name);
  on('launchpad-open', (name) => { const a = find(name); hide(); if (a) setTimeout(() => c.launchPath(a.path), 60); });
  on('launchpad-hide', hide);
  on('launchpad-context', (name, e) => {
    const a = find(name);
    if (!a) return;
    const inDock = S().apps.some(x => x.path === a.path);
    const items = [
      { label: t('lp.open'), click: () => { hide(); c.launchPath(a.path); } },
      { label: t('dock.keep'), enabled: !inDock, click: () => c.patch({ apps: [...S().apps, { id: Date.now().toString(36), type: 'app', name: a.name, path: a.path, exe: a.exe || undefined }] }) },
    ];
    if (a.path && !/^shell:/i.test(a.path) && fs.existsSync(a.path)) items.push({ label: t('dock.showInFolder'), click: () => { hide(); shell.showItemInFolder(a.path); } });
    items.push({ type: 'separator' }, { label: t('lp.hide'), click: () => { c.patch({ launchpadHidden: [...(S().launchpadHidden || []), a.name] }); send(W.launchpad, 'launchpad-remove', a.name); } });
    if ((S().launchpadHidden || []).length) items.push({ label: t('lp.unhide', { n: S().launchpadHidden.length }), click: () => { c.patch({ launchpadHidden: [] }); hide(); setTimeout(launchpad, 100); } });
    Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(e.sender) });
  });
  on('launchpad-refresh', async () => { await c.apps.refresh(); if (alive(W.launchpad) && W.launchpad.isVisible()) { hide(); setTimeout(launchpad, 100); } });

  hooks.shortcuts.push((reg) => reg('launchpad', S().launchpadShortcut, launchpad));
};
