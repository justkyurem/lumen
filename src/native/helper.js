// Ponte verso helper.ps1: un processo PowerShell persistente che parla JSON riga per riga.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

class Helper {
  constructor(name, userDataDir, scriptName = 'helper.ps1') {
    this.name = name;
    this.scriptName = scriptName;
    this.script = path.join(userDataDir, 'lumen-' + scriptName);
    this.pending = new Map();
    this.seq = 0;
    this.dead = false;
    this._newReady();
  }

  // Le richieste attendono "ready": durante un riavvio aspettano il nuovo processo invece di finire nel vecchio.
  _newReady() { this.ready = new Promise((res) => { this._resolveReady = res; }); }

  start() {
    // Lo script è dentro l'asar: PowerShell non lo legge da lì, quindi lo copiamo in userData.
    // Il BOM serve a PowerShell 5 per leggere lo script come UTF-8 (accenti nelle etichette)
    const src = '﻿' + fs.readFileSync(path.join(__dirname, this.scriptName), 'utf8').replace(/^﻿/, '');
    try { if (fs.readFileSync(this.script, 'utf8') !== src) throw 0; } catch { fs.writeFileSync(this.script, src); }

    const proc = spawn('powershell.exe',
      ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => this._onLine(line));
    proc.stderr.on('data', (d) => { if (process.env.LUMEN_DEBUG) console.error(`[${this.name}]`, d.toString()); });
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this._newReady();
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('helper terminato')); }
      this.pending.clear();
      if (!this.dead) setTimeout(() => this.start(), 300);
    });
  }

  _onLine(line) {
    if (!line.startsWith('{')) return;
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.ready) return this._resolveReady();
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
  }

  async call(cmd, args = {}, timeout = 8000) {
    await this.ready;
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${cmd}`));
        // Il processo è bloccato: lo riavviamo, altrimenti tutte le richieste successive resterebbero in coda
        try { this.proc.kill(); } catch {}
      }, timeout);
      const t0 = Date.now();
      const dbg = process.env.LUMEN_DEBUG && cmd !== 'clipInfo' && cmd !== 'foreground' && cmd !== 'windows';
      if (dbg) console.error(`[${this.name}] -> ${cmd} (in coda: ${this.pending.size})`);
      this.pending.set(id, {
        resolve: (v) => { if (dbg) console.error(`[${this.name}] <- ${cmd} ${Date.now() - t0}ms`); resolve(v); },
        reject, timer,
      });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  // Variante che non lancia mai: restituisce fallback in caso di errore.
  async safe(cmd, args, fallback = null, timeout) {
    try { return await this.call(cmd, args, timeout); } catch (e) {
      if (process.env.LUMEN_DEBUG) console.error(`[${this.name}] ${cmd}:`, e.message);
      return fallback;
    }
  }

  stop() { this.dead = true; try { this.proc.kill(); } catch {} }
}

module.exports = { Helper };
