// Base condivisa da tutte le finestre: impostazioni, tema, traduzioni.
window.App = {
  S: {},
  dict: {},
  t(key, vars) {
    let s = this.dict[key];
    if (s === undefined) s = key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(v);
    return s;
  },
  translate(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = this.t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = this.t(el.dataset.i18nPh); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = this.t(el.dataset.i18nTitle); });
  },
  apply(s) {
    this.S = s;
    const r = document.documentElement;
    r.dataset.dark = s.skin === 'demoniaccio' ? true : s.dark;
    r.dataset.skin = s.skin || 'default';
    r.lang = s.lang;
    r.style.setProperty('--accent', s.accent);
    this.translate();
  },
  async init(onSettings) {
    this.dict = await window.lumen.i18n();
    const s = await window.lumen.getSettings();
    this.apply(s);
    onSettings && onSettings(s, true);
    window.lumen.on('settings', async (s) => {
      if (s.lang !== this.S.lang) this.dict = await window.lumen.i18n();
      this.apply(s);
      onSettings && onSettings(s, false);
    });
  },
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  icon(name) { return `<span class="ico">${(window.ICONS && window.ICONS[name]) || ''}</span>`; },
};
window.t = (k, v) => window.App.t(k, v);
