const root = document.getElementById('root');
const { esc } = App;
let S = {}, stats = null, weather = null, inside = false;
const els = {};
let calView = null, calSel = null;

const loc = () => (S.lang === 'en' ? 'en-GB' : 'it-IT');

// ---------- Icone meteo ----------
const WI = {
  sun: '<circle cx="24" cy="24" r="8" fill="#FFC53D"/><g stroke="#FFC53D" stroke-width="3" stroke-linecap="round"><path d="M24 6v4M24 38v4M6 24h4M38 24h4M11.3 11.3l2.8 2.8M33.9 33.9l2.8 2.8M11.3 36.7l2.8-2.8M33.9 14.1l2.8-2.8"/></g>',
  moon: '<path d="M32 30a12 12 0 0 1-14-18 13 13 0 1 0 14 18z" fill="#C9D3FF"/>',
  cloud: '<path d="M15 36h19a8 8 0 0 0 .8-16A11 11 0 0 0 13.6 23 6.5 6.5 0 0 0 15 36z" fill="#C8CEDA"/>',
  partly: '<circle cx="18" cy="17" r="7" fill="#FFC53D"/><path d="M17 38h18a7.5 7.5 0 0 0 .8-15A10 10 0 0 0 16.4 26 6 6 0 0 0 17 38z" fill="#DDE2EA"/>',
  rain: '<path d="M15 30h19a8 8 0 0 0 .8-16A11 11 0 0 0 13.6 17 6.5 6.5 0 0 0 15 30z" fill="#AEB7C7"/><g stroke="#4DA3FF" stroke-width="2.5" stroke-linecap="round"><path d="M17 35l-2 5M25 35l-2 5M33 35l-2 5"/></g>',
  snow: '<path d="M15 30h19a8 8 0 0 0 .8-16A11 11 0 0 0 13.6 17 6.5 6.5 0 0 0 15 30z" fill="#C8CEDA"/><g fill="#9FD3FF"><circle cx="17" cy="37" r="2"/><circle cx="25" cy="40" r="2"/><circle cx="33" cy="37" r="2"/></g>',
  storm: '<path d="M15 28h19a8 8 0 0 0 .8-16A11 11 0 0 0 13.6 15 6.5 6.5 0 0 0 15 28z" fill="#8E97A8"/><path d="M25 28l-5 9h5l-3 8 9-11h-5l3-6z" fill="#FFC53D"/>',
  fog: '<g stroke="#B5BCC8" stroke-width="3" stroke-linecap="round"><path d="M10 18h28M14 25h24M10 32h26M16 39h18"/></g>',
};
function wkind(code, day = 1) {
  if (code === 0) return day ? 'sun' : 'moon';
  if (code <= 2) return day ? 'partly' : 'moon';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloud';
}
const wsvg = (k) => `<svg viewBox="0 0 48 48">${WI[k]}</svg>`;

// ---------- Costruzione ----------
const BUILD = {
  clock(el) { el.className = 'w clock'; el.innerHTML = '<div class="time"></div><div class="date"></div>'; },
  weather(el) { el.className = 'w weather'; },
  calendar(el) { el.className = 'w cal'; },
  notes(el) {
    el.className = 'w notes';
    el.innerHTML = `<h4>${esc(t('w.notes'))}</h4><textarea spellcheck="false" placeholder="${esc(t('w.notesPh'))}"></textarea>`;
    const ta = el.querySelector('textarea');
    ta.value = S.notes || '';
    let tm; ta.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => window.lumen.update({ notes: ta.value }), 500); });
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(150, ta.scrollHeight) + 'px'; };
    ta.addEventListener('input', grow); setTimeout(grow);
  },
  system(el) { el.className = 'w sys'; },
};

function sync() {
  for (const name of Object.keys(BUILD)) {
    const cfg = S.widgets[name];
    if (cfg && cfg.on) {
      if (!els[name]) { const el = document.createElement('div'); el.dataset.w = name; BUILD[name](el); root.appendChild(el); els[name] = el; }
      if (!els[name].classList.contains('dragging')) { els[name].style.left = cfg.x + 'px'; els[name].style.top = cfg.y + 'px'; }
    } else if (els[name]) { els[name].remove(); delete els[name]; }
  }
  if (els.notes) { const ta = els.notes.querySelector('textarea'); if (document.activeElement !== ta) ta.value = S.notes || ''; els.notes.querySelector('h4').textContent = t('w.notes'); ta.placeholder = t('w.notesPh'); }
  renderAll();
}

function renderAll() { renderClock(); renderWeather(); renderCalendar(); renderSystem(); }

function renderClock() {
  const el = els.clock; if (!el) return;
  const d = new Date();
  el.querySelector('.time').textContent = d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', hour12: !S.clock24 });
  el.querySelector('.date').textContent = d.toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' });
}

function renderWeather() {
  const el = els.weather; if (!el) return;
  if (el.contains(document.activeElement)) return;
  const head = `<h4>${esc(t('w.weather'))}${weather && weather.city ? `<a data-act="city">${esc(weather.city)}</a>` : ''}</h4>`;
  if (!S.weatherCity || (weather && weather.error === 'city')) {
    el.innerHTML = head + `<div class="msg">${esc(t(weather && weather.error === 'city' ? 'w.cityNotFound' : 'w.setCity'))}</div><input data-act="cityInput" placeholder="${esc(t('w.cityPh'))}" value="${esc(S.weatherCity || '')}">`;
    return;
  }
  if (!weather) { el.innerHTML = head + `<div class="msg">${esc(t('w.loading'))}</div>`; return; }
  if (weather.error) { el.innerHTML = head + `<div class="msg">${esc(t('w.offline'))}</div>`; return; }
  const c = weather.current, dly = weather.daily;
  const days = dly.time.map((d, i) => ({
    name: i === 0 ? t('w.today') : new Date(d + 'T12:00').toLocaleDateString(loc(), { weekday: 'short' }).replace('.', ''),
    k: wkind(dly.weather_code[i]), hi: Math.round(dly.temperature_2m_max[i]), lo: Math.round(dly.temperature_2m_min[i]),
  }));
  el.innerHTML = head + `
    <div class="now">${wsvg(wkind(c.weather_code, c.is_day))}<div><div class="temp">${Math.round(c.temperature_2m)}°</div><div class="desc">${esc(t('wc.' + wkind(c.weather_code, c.is_day)))} · ${days[0].hi}° / ${days[0].lo}°</div></div></div>
    <div class="days">${days.map(d => `<div>${esc(d.name)}${wsvg(d.k)}<b>${d.hi}°</b> <span class="lo">${d.lo}°</span></div>`).join('')}</div>`;
}

function renderCalendar() {
  const el = els.calendar; if (!el) return;
  if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const now = new Date();
  calView = calView || new Date(now.getFullYear(), now.getMonth(), 1);
  const y = calView.getFullYear(), m = calView.getMonth();
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7; // lunedì primo
  const start = new Date(y, m, 1 - offset);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const evDays = new Set((S.events || []).map(e => e.date));
  const todayK = key(now);
  calSel = calSel || todayK;
  const dn = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(loc(), { weekday: 'narrow' }));
  let cells = dn.map(d => `<div class="dn">${esc(d)}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = key(d);
    cells += `<div class="d ${d.getMonth() !== m ? 'out' : ''} ${k === todayK ? 'today' : ''} ${k === calSel ? 'sel' : ''} ${evDays.has(k) ? 'ev' : ''}" data-day="${k}">${d.getDate()}</div>`;
  }
  const list = (S.events || []).filter(e => e.date === calSel);
  const selDate = new Date(calSel + 'T12:00');
  el.innerHTML = `
    <div class="month"><button data-act="prev">‹</button><span>${esc(first.toLocaleDateString(loc(), { month: 'long', year: 'numeric' }))}</span><button data-act="next">›</button></div>
    <div class="grid">${cells}</div>
    <div class="events">
      <h4>${esc(selDate.toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' }))}</h4>
      ${list.length ? list.map(e => `<div class="ev-item"><i></i><span>${esc(e.text)}</span><button data-del="${e.id}">×</button></div>`).join('') : `<div class="none">${esc(t('w.noEvents'))}</div>`}
      <input data-act="addEvent" placeholder="${esc(t('w.addEvent'))}">
    </div>`;
}

function renderSystem() {
  const el = els.system; if (!el) return;
  const gb = (b) => (b / 1024 ** 3).toFixed(1);
  const bar = (label, v, extra = '') => `<div class="m"><div class="lab"><span>${esc(label)}</span><b>${Math.round(v * 100)}%${extra}</b></div><div class="barx"><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
  if (!stats) { el.innerHTML = `<h4>${esc(t('w.system'))}</h4><div class="up">${esc(t('w.loading'))}</div>`; return; }
  const up = stats.uptime, h = Math.floor(up / 3600), mm = Math.floor(up / 60) % 60;
  el.innerHTML = `<h4>${esc(t('w.system'))}</h4>
    ${bar('CPU', stats.cpu)}
    ${bar(t('w.memory'), stats.mem, ` · ${gb(stats.memUsed)}/${gb(stats.memTotal)} GB`)}
    ${stats.disk !== null ? bar(t('w.disk'), stats.disk) : ''}
    <div class="up">${esc(t('w.uptime', { h, m: mm }))}</div>`;
}

// ---------- Interazione ----------
root.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  const day = e.target.closest('[data-day]');
  const del = e.target.closest('[data-del]');
  if (day) { calSel = day.dataset.day; renderCalendar(); return; }
  if (del) { window.lumen.update({ events: (S.events || []).filter(x => x.id !== del.dataset.del) }); return; }
  if (!a) return;
  if (a.dataset.act === 'prev' || a.dataset.act === 'next') {
    calView = new Date(calView.getFullYear(), calView.getMonth() + (a.dataset.act === 'prev' ? -1 : 1), 1); renderCalendar();
  }
  if (a.dataset.act === 'city') window.lumen.openSettings('widget');
});
root.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const a = e.target.dataset.act;
  if (a === 'cityInput' && e.target.value.trim()) { window.lumen.update({ weatherCity: e.target.value.trim() }); e.target.blur(); }
  if (a === 'addEvent' && e.target.value.trim()) {
    const ev = { id: Math.random().toString(36).slice(2, 9), date: calSel, text: e.target.value.trim() };
    e.target.value = '';
    e.target.blur();
    window.lumen.update({ events: [...(S.events || []), ev] });
  }
});

// Trascinamento
let drag = null;
root.addEventListener('mousedown', (e) => {
  const w = e.target.closest('.w');
  if (!w || e.button !== 0 || e.target.closest('input, textarea, button, a, [data-day], [data-del]')) return;
  const r = w.getBoundingClientRect();
  drag = { w, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
});
document.addEventListener('mousemove', (e) => {
  if (drag) {
    if (!drag.moved) { drag.moved = true; drag.w.classList.add('dragging'); }
    const x = Math.max(0, Math.min(window.innerWidth - drag.w.offsetWidth, e.clientX - drag.dx));
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
    drag.w.style.left = x + 'px'; drag.w.style.top = y + 'px';
    return;
  }
  const over = !!document.elementFromPoint(e.clientX, e.clientY)?.closest('.w');
  if (over !== inside) { inside = over; window.lumen.widgetsMouse(inside); }
});
document.addEventListener('mouseup', () => {
  if (!drag) return;
  const { w, moved } = drag; drag = null;
  w.classList.remove('dragging');
  if (moved) {
    // Aggancio a una griglia di 10px per allineamenti puliti
    const x = Math.round(parseInt(w.style.left) / 10) * 10, y = Math.round(parseInt(w.style.top) / 10) * 10;
    w.style.left = x + 'px'; w.style.top = y + 'px';
    window.lumen.update({ widgets: { [w.dataset.w]: { x, y } } });
  }
});
document.addEventListener('mouseleave', () => { if (!drag && inside) { inside = false; window.lumen.widgetsMouse(false); } });

window.lumen.on('stats', (s) => { stats = s; renderSystem(); });
window.lumen.on('weather', (w) => { weather = w; renderWeather(); });
setInterval(renderClock, 1000);
setInterval(() => { const k = new Date().toDateString(); if (k !== renderCalendar.last) { renderCalendar.last = k; renderCalendar(); } }, 60000);

App.init(async (s, first) => {
  S = s;
  if (first) { const st = await window.lumen.widgetsState(); stats = st.stats; weather = st.weather; }
  sync();
});
