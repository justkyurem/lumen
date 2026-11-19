// Indice delle app installate (menu Start) + risoluzione icone con cache.
const { app, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const KNOWN_FOLDERS = {
  '{6D809377-6AF0-444B-8957-A3773F02200E}': process.env.ProgramW6432 || 'C:\\Program Files',
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': process.env.SystemRoot || 'C:\\Windows',
  '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64'),
};

const START_DIRS = [
  path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
  path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs'),
];

function walkLnk(dir, out, depth = 0) {
  if (depth > 4) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkLnk(p, out, depth + 1);
    else if (/\.(lnk|url)$/i.test(e.name)) out.set(e.name.replace(/\.(lnk|url)$/i, '').toLowerCase(), p);
  }
}

function resolveAppIdPath(id) {
  const m = /^(\{[0-9A-F-]+\})\\(.+)$/i.exec(id);
  if (m && KNOWN_FOLDERS[m[1].toUpperCase()]) return path.join(KNOWN_FOLDERS[m[1].toUpperCase()], m[2]);
  if (/^[a-z]:\\/i.test(id)) return id;
  return null;
}

class AppIndex {
  constructor(helper) {
    this.helper = helper;
    this.items = [];
    this.icons = new Map();
  }

  async refresh() {
    const lnks = new Map();
    START_DIRS.forEach(d => walkLnk(d, lnks));
    const start = await this.helper.safe('startApps', {}, [], 20000) || [];
    const seen = new Set();
    const items = [];
    for (const s of start) {
      if (!s || !s.name || seen.has(s.name.toLowerCase())) continue;
      if (/^(uninstall|disinstalla)/i.test(s.name)) continue;
      seen.add(s.name.toLowerCase());
      const file = resolveAppIdPath(s.id);
      const lnk = lnks.get(s.name.toLowerCase());
      items.push({
        name: s.name,
        appId: s.id,
        path: lnk || (file && fs.existsSync(file) ? file : 'shell:AppsFolder\\' + s.id),
        iconSrc: lnk || file || null,
        exe: exeFrom(lnk || file),
      });
    }
    // Collegamenti non elencati da Get-StartApps
    for (const [name, p] of lnks) {
      if (seen.has(name)) continue;
      seen.add(name);
      items.push({ name: path.basename(p).replace(/\.(lnk|url)$/i, ''), path: p, iconSrc: p, exe: exeFrom(p) });
    }
    this.items = items;
    return items;
  }

  search(q, limit = 8) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const it of this.items) {
      const s = score(it.name.toLowerCase(), q);
      if (s > 0) scored.push([s, it]);
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(x => x[1]);
  }

  async icon(src, size = 'large') {
    if (!src) return null;
    const key = src + '|' + size;
    if (this.icons.has(key)) return this.icons.get(key);
    let url = null;
    try {
      if (/\.(png|jpe?g|ico|bmp|webp)$/i.test(src)) {
        url = nativeImage.createFromPath(src).resize({ width: 128, height: 128, quality: 'best' }).toDataURL();
      } else {
        let target = src;
        if (/\.lnk$/i.test(target)) {
          try {
            const l = shell.readShortcutLink(target);
            if (l.icon && fs.existsSync(l.icon) && !/\.dll$/i.test(l.icon)) target = l.icon;
            else if (l.target && fs.existsSync(l.target)) target = l.target;
          } catch {}
        }
        if (fs.existsSync(target)) url = (await app.getFileIcon(target, { size })).toDataURL();
      }
    } catch {}
    this.icons.set(key, url);
    return url;
  }
}

function exeFrom(p) {
  if (!p) return null;
  if (/\.lnk$/i.test(p)) {
    try { p = shell.readShortcutLink(p).target || p; } catch {}
  }
  return /\.exe$/i.test(p) ? path.basename(p).toLowerCase() : null;
}

// Punteggio: prefisso > inizio parola > sottostringa > sottosequenza
function score(name, q) {
  if (name === q) return 100;
  if (name.startsWith(q)) return 80 - name.length / 100;
  const words = name.split(/[\s\-_.]+/);
  if (words.some(w => w.startsWith(q))) return 60 - name.length / 100;
  const initials = words.map(w => w[0]).join('');
  if (initials.startsWith(q)) return 50;
  if (name.includes(q)) return 40 - name.indexOf(q) / 10;
  let i = 0;
  for (const c of name) if (c === q[i]) i++;
  return i === q.length ? 10 : 0;
}

module.exports = { AppIndex, exeFrom };
