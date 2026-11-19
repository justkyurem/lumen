// Client minimo per obs-websocket v5 (OBS 28+: Strumenti → Impostazioni server WebSocket).
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');

class OBS {
  constructor(onChange) {
    this.ws = null;
    this.ready = false;
    this.pending = new Map();
    this.seq = 0;
    this.onChange = onChange || (() => {});
    this.error = null;
  }

  connect({ host = 'localhost', port = 4455, password = '' } = {}) {
    if (this.ws && (this.ready || this.connecting)) return this.connecting || Promise.resolve(true);
    this.close();
    this.connecting = new Promise((resolve) => {
      let done = false;
      const finish = (ok, err) => { if (done) return; done = true; this.connecting = null; this.error = err || null; resolve(ok); this.onChange(); };
      const timer = setTimeout(() => { finish(false, 'timeout'); this.close(); }, 4000);
      let ws;
      try { ws = new WebSocket(`ws://${host}:${port}`); } catch { clearTimeout(timer); return finish(false, 'url'); }
      this.ws = ws;
      ws.onerror = () => { clearTimeout(timer); finish(false, 'offline'); };
      ws.onclose = () => { this.ready = false; for (const p of this.pending.values()) p.reject(new Error('closed')); this.pending.clear(); clearTimeout(timer); finish(false, this.error || 'offline'); this.onChange(); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.op === 0) {
          const d = { rpcVersion: 1, eventSubscriptions: (1 << 2) | (1 << 6) }; // Scenes + Outputs
          const a = m.d.authentication;
          if (a) {
            if (!password) { clearTimeout(timer); finish(false, 'password'); return this.close(); }
            d.authentication = sha(sha(password + a.salt) + a.challenge);
          }
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (m.op === 2) {
          this.ready = true; clearTimeout(timer); finish(true);
        } else if (m.op === 7) {
          const p = this.pending.get(m.d.requestId);
          if (!p) return;
          this.pending.delete(m.d.requestId);
          m.d.requestStatus.result ? p.resolve(m.d.responseData || {}) : p.reject(new Error(m.d.requestStatus.comment || 'error'));
        } else if (m.op === 5) {
          this.onChange(m.d.eventType);
        }
      };
    });
    return this.connecting;
  }

  request(requestType, requestData) {
    if (!this.ready) return Promise.reject(new Error('not connected'));
    const requestId = String(++this.seq);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      setTimeout(() => { if (this.pending.delete(requestId)) reject(new Error('timeout')); }, 5000);
    });
  }

  async status() {
    if (!this.ready) return { connected: false, error: this.error };
    try {
      const [st, rec, scenes] = await Promise.all([this.request('GetStreamStatus'), this.request('GetRecordStatus'), this.request('GetSceneList')]);
      return {
        connected: true, streaming: !!st.outputActive, recording: !!rec.outputActive, streamTime: st.outputTimecode,
        scene: scenes.currentProgramSceneName, scenes: (scenes.scenes || []).map(s => s.sceneName).reverse(),
      };
    } catch (e) { return { connected: this.ready, error: e.message }; }
  }

  close() { try { this.ws && this.ws.close(); } catch {} this.ws = null; this.ready = false; }
}

module.exports = { OBS };
