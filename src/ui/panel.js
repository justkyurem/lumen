const $ = (id) => document.getElementById(id);
const { esc } = App;
let S = {}, view = null, selDay = null, weather = null, media = null;
const loc = () => (S.lang === 'en' ? 'en-GB' : 'it-IT');
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

$('bellIco').innerHTML = window.ICONS.bell;
$('art').innerHTML = App.icon('music');
$('bPrev').innerHTML = App.icon('prev'); $('bNext').innerHTML = App.icon('next');

function head() {
  const d = new Date();
  $('day').textContent = d.toLocaleDateString(loc(), { weekday: 'long' });
  $('date').textContent = d.toLocaleDateString(loc(), { day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', hour12: !S.clock24 });
}
setInterval(head, 10000);

function cal() {
  if ($('cal').contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const now = new Date();
  view = view || new Date(now.getFullYear(), now.getMonth(), 1);
  selDay = selDay || key(now);
  const y = view.getFullYear(), m = view.getMonth();
  const start = new Date(y, m, 1 - ((new Date(y, m, 1).getDay() + 6) % 7));
  const evDays = new Set((S.events || []).map(e => e.date));
  let cells = [...Array(7)].map((_, i) => `<div class="dn">${esc(new Date(2024, 0, 1 + i).toLocaleDateString(loc(), { weekday: 'narrow' }))}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = key(d);
    cells += `<div class="d ${d.getMonth() !== m ? 'out' : ''} ${k === key(now) ? 'today' : ''} ${k === selDay ? 'sel' : ''} ${evDays.has(k) ? 'ev' : ''}" data-day="${k}">${d.getDate()}</div>`;
  }
  const list = (S.events || []).filter(e => e.date === selDay);
  $('cal').innerHTML = `
    <div class="month"><button data-m="-1">‹</button><span>${esc(view.toLocaleDateString(loc(), { month: 'long', year: 'numeric' }))}</span><button data-m="1">›</button></div>
    <div class="grid">${cells}</div>
    <h4 style="margin-top:12px">${esc(new Date(selDay + 'T12:00').toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' }))}</h4>
    ${list.length ? list.map(e => `<div class="ev-item"><i></i><span>${esc(e.text)}</span><button data-del="${e.id}">×</button></div>`).join('') : `<div class="muted">${esc(t('w.noEvents'))}</div>`}
    <input class="add" placeholder="${esc(t('w.addEvent'))}">`;
}
$('cal').addEventListener('click', (e) => {
  const m = e.target.closest('[data-m]'), d = e.target.closest('[data-day]'), del = e.target.closest('[data-del]');
  if (m) { view = new Date(view.getFullYear(), view.getMonth() + Number(m.dataset.m), 1); cal(); }
  if (d) { selDay = d.dataset.day; cal(); }
  if (del) window.lumen.update({ events: (S.events || []).filter(x => x.id !== del.dataset.del) });
});
$('cal').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.classList.contains('add') || !e.target.value.trim()) return;
  const ev = { id: Math.random().toString(36).slice(2, 9), date: selDay, text: e.target.value.trim() };
  e.target.value = ''; e.target.blur();
  window.lumen.update({ events: [...(S.events || []), ev] });
});

function wx() {
  const el = $('wx');
  if (!weather || weather.error || !weather.current) return el.classList.add('hidden');
  el.classList.remove('hidden');
  const dly = weather.daily;
  el.innerHTML = `<h4>${esc(t('w.weather'))}<span style="text-transform:none;letter-spacing:0">${esc(weather.city)}</span></h4>
    <div class="wx"><div class="t">${Math.round(weather.current.temperature_2m)}°</div><div class="muted">${Math.round(dly.temperature_2m_max[0])}° / ${Math.round(dly.temperature_2m_min[0])}°</div></div>`;
}

async function loadMedia() {
  media = await window.lumen.panelMedia();
  $('mediaCard').classList.toggle('hidden', !media || !media.title);
  if (media && media.title) {
    $('mTitle').textContent = media.title; $('mArtist').textContent = media.artist || media.app || '';
    $('bPlay').innerHTML = App.icon(media.playing ? 'pause' : 'play');
  }
}
document.querySelectorAll('.ctl button').forEach(b => b.addEventListener('click', () => { window.lumen.ccSet('media', b.dataset.k); setTimeout(loadMedia, 700); }));
$('winNotif').addEventListener('click', () => window.lumen.panelWinNotifications());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.lumen.togglePanel(); });

window.lumen.on('panel-open', (d) => { weather = d.weather; head(); cal(); wx(); loadMedia(); });
App.init((s) => { S = s; head(); cal(); wx(); });
