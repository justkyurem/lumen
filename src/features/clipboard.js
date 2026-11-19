// Cronologia appunti: legge solo quando cambia il numero di sequenza di Windows,
// salta i contenuti marcati dai password manager.
const { clipboard, nativeImage, ClipboardItem } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ClipHistory {
  constructor(dir, helper, getMax, onChange) {
    this.dir = path.join(dir, 'clips');
    this.file = path.join(dir, 'clips.json');
    this.helper = helper;
    this.getMax = getMax;
    this.onChange = onChange;
    this.items = [];
    this.lastSeq = null;
    this.ignoreSeq = null;
    this.timer = null;
    this.saveT = null;
    this.source = () => '';
    try { this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    fs.mkdirSync(this.dir, { recursive: true });
  }

  start() { if (!this.timer) this.timer = setInterval(() => this.poll(), 700); }
  stop() { clearInterval(this.timer); this.timer = null; }

  async poll() {
    const info = await this.helper.safe('clipInfo', {}, null, 2000);
    if (!info) return;
    if (this.lastSeq === null) { this.lastSeq = info.seq; return; } // non catturare ciò che c'era all'avvio
    if (info.seq === this.lastSeq) return;
    this.lastSeq = info.seq;
    if (info.exclude || info.seq === this.ignoreSeq) return;
    this.capture();
  }

  // Electron 45+: API degli appunti asincrona in stile W3C (clipboard.read / ClipboardItem)
  async readCurrent() {
    const items = await clipboard.read();
    const it = items && items[0];
    if (!it) return {};
    if (it.types.includes('text/plain')) return { text: await (await it.getType('text/plain')).text() };
    if (it.types.includes('image/png')) {
      const buf = Buffer.from(await (await it.getType('image/png')).arrayBuffer());
      const img = nativeImage.createFromBuffer(buf);
      return img.isEmpty() ? {} : { img, png: buf };
    }
    return {};
  }

  async capture() {
    let cur;
    try { cur = await this.readCurrent(); } catch { return; }
    const text = cur.text;
    let item = null;
    const img = cur.img;
    if (img) {
      const png = cur.png;
      const hash = crypto.createHash('sha1').update(png).digest('hex').slice(0, 16);
      if (this.items[0] && this.items[0].hash === hash) return;
      const id = 'i' + Date.now().toString(36);
      const file = path.join(this.dir, id + '.png');
      fs.writeFileSync(file, png);
      const { width, height } = img.getSize();
      const thumb = img.resize(width > height ? { width: Math.min(width, 360) } : { height: Math.min(height, 240) }).toDataURL();
      item = { id, type: 'image', file, thumb, w: width, h: height, hash };
    } else if (text && text.trim()) {
      const t = text.length > 100000 ? text.slice(0, 100000) : text;
      const dup = this.items.findIndex(i => i.type === 'text' && i.text === t);
      if (dup === 0) return;
      if (dup > 0) { const [d] = this.items.splice(dup, 1); d.ts = Date.now(); d.source = this.source(); this.items.unshift(d); return this.changed(); }
      item = { id: 't' + Date.now().toString(36), type: 'text', text: t };
    }
    if (!item) return;
    item.ts = Date.now();
    item.source = this.source();
    this.items.unshift(item);
    this.trim();
    this.changed();
  }

  trim() {
    const max = this.getMax();
    const unpinned = this.items.filter(i => !i.pinned);
    if (unpinned.length <= max) return;
    const drop = new Set(unpinned.slice(max).map(i => i.id));
    for (const i of this.items) if (drop.has(i.id) && i.file) fs.rm(i.file, { force: true }, () => {});
    this.items = this.items.filter(i => !drop.has(i.id));
  }

  changed() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => fs.writeFile(this.file, JSON.stringify(this.items), () => {}), 400);
    this.onChange && this.onChange();
  }

  async use(id) {
    const it = this.items.find(i => i.id === id);
    if (!it) return false;
    if (it.type === 'text') await clipboard.writeText(it.text);
    else await clipboard.write([new ClipboardItem({ 'image/png': new Blob([fs.readFileSync(it.file)], { type: 'image/png' }) })]);
    const info = await this.helper.safe('clipInfo', {}, null, 2000);
    if (info) { this.ignoreSeq = info.seq; this.lastSeq = info.seq; }
    // Porta l'elemento in cima
    this.items = [it, ...this.items.filter(i => i !== it)];
    it.ts = Date.now();
    this.changed();
    return true;
  }

  pin(id) { const it = this.items.find(i => i.id === id); if (it) { it.pinned = !it.pinned; this.changed(); } }

  remove(id) {
    const it = this.items.find(i => i.id === id);
    if (it && it.file) fs.rm(it.file, { force: true }, () => {});
    this.items = this.items.filter(i => i.id !== id);
    this.changed();
  }

  clear() {
    for (const i of this.items) if (!i.pinned && i.file) fs.rm(i.file, { force: true }, () => {});
    this.items = this.items.filter(i => i.pinned);
    this.changed();
  }
}

module.exports = { ClipHistory };
