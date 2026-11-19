// Ricerca in preferiti e cronologia di Chrome, Edge, Brave e Firefox. Tutto resta sul PC:
// i database vengono copiati in una cartella di Lumen (i browser li tengono bloccati) e letti in sola lettura.
const fs = require('fs');
const path = require('path');

const LOCAL = process.env.LOCALAPPDATA || '';
const ROAM = process.env.APPDATA || '';
const CHROMIUM = [
  ['Chrome', path.join(LOCAL, 'Google', 'Chrome', 'User Data')],
  ['Edge', path.join(LOCAL, 'Microsoft', 'Edge', 'User Data')],
  ['Brave', path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data')],
];

function profilesOf(dir) {
  try { return fs.readdirSync(dir).filter(n => n === 'Default' || /^Profile \d+$/.test(n)).map(n => path.join(dir, n)); } catch { return []; }
}

class BrowserSearch {
  constructor(cacheDir) {
    this.cacheDir = path.join(cacheDir, 'browser-cache');
    this.bookmarks = null;
    this.bmAt = 0;
    this.copiedAt = new Map();
    this.sqlite = null;
    try { this.sqlite = require('node:sqlite'); } catch {}
  }

  loadBookmarks() {
    if (this.bookmarks && Date.now() - this.bmAt < 5 * 60000) return this.bookmarks;
    const out = [];
    const walk = (node, browser) => {
      if (!node) return;
      if (node.type === 'url' && node.url) out.push({ name: node.name || node.url, url: node.url, browser });
      (node.children || []).forEach(c => walk(c, browser));
    };
    for (const [browser, dir] of CHROMIUM) {
      for (const prof of profilesOf(dir)) {
        try { const j = JSON.parse(fs.readFileSync(path.join(prof, 'Bookmarks'), 'utf8')); Object.values(j.roots || {}).forEach(r => walk(r, browser)); } catch {}
      }
    }
    this.bookmarks = out; this.bmAt = Date.now();
    return out;
  }

  // Copia il database se la copia ha più di 5 minuti
  copy(src, name) {
    const dest = path.join(this.cacheDir, name);
    const last = this.copiedAt.get(dest) || 0;
    if (Date.now() - last > 5 * 60000 || !fs.existsSync(dest)) {
      try { fs.mkdirSync(this.cacheDir, { recursive: true }); fs.copyFileSync(src, dest); this.copiedAt.set(dest, Date.now()); } catch { return fs.existsSync(dest) ? dest : null; }
    }
    return dest;
  }

  history(q, limit) {
    if (!this.sqlite) return [];
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const out = [];
    const run = (file, sql, browser) => {
      let db;
      try {
        db = new this.sqlite.DatabaseSync(file, { readOnly: true });
        for (const r of db.prepare(sql).all(like, like, limit)) out.push({ name: r.title || r.url, url: r.url, browser, score: r.score || 0 });
      } catch {} finally { try { db && db.close(); } catch {} }
    };
    for (const [browser, dir] of CHROMIUM) {
      profilesOf(dir).forEach((prof, i) => {
        const src = path.join(prof, 'History');
        if (!fs.existsSync(src)) return;
        const f = this.copy(src, `${browser}-${i}.db`);
        if (f) run(f, 'SELECT url, title, visit_count AS score FROM urls WHERE (title LIKE ? OR url LIKE ?) AND hidden = 0 ORDER BY visit_count DESC, last_visit_time DESC LIMIT ?', browser);
      });
    }
    try {
      const ff = path.join(ROAM, 'Mozilla', 'Firefox', 'Profiles');
      fs.readdirSync(ff).forEach((p, i) => {
        const src = path.join(ff, p, 'places.sqlite');
        if (!fs.existsSync(src)) return;
        const f = this.copy(src, `firefox-${i}.db`);
        if (f) run(f, 'SELECT url, title, frecency AS score FROM moz_places WHERE (title LIKE ? OR url LIKE ?) AND hidden = 0 ORDER BY frecency DESC LIMIT ?', 'Firefox');
      });
    } catch {}
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  search(q, { history = true } = {}) {
    const ql = q.trim().toLowerCase();
    if (ql.length < 2) return [];
    const seen = new Set();
    const res = [];
    for (const b of this.loadBookmarks()) {
      if (res.length >= 4) break;
      if ((b.name.toLowerCase().includes(ql) || b.url.toLowerCase().includes(ql)) && !seen.has(b.url)) { seen.add(b.url); res.push({ ...b, kind: 'bookmark' }); }
    }
    if (history) for (const h of this.history(q.trim(), 6)) { if (!seen.has(h.url) && res.length < 7) { seen.add(h.url); res.push({ ...h, kind: 'history' }); } }
    return res;
  }

  clearCache() { try { fs.rmSync(this.cacheDir, { recursive: true, force: true }); } catch {} this.copiedAt.clear(); }
}

module.exports = { BrowserSearch };
