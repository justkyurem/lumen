const $ = (id) => document.getElementById(id);
let S = {}, active = null, pomo = null;

$('cc').innerHTML = App.icon('sliders');
document.querySelector('#wifiIco').remove(); // lo stato radio vive nel centro di controllo

function locale() { return S.lang === 'en' ? 'en-GB' : 'it-IT'; }

function renderLabel() {
  const name = S.menubarShowActiveApp && active && active.name ? active.name : S.menubarLabel;
  $('label').textContent = name || '';
  $('label').classList.toggle('hidden', !name);
}

function tick() {
  const d = new Date();
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: S.showSeconds ? '2-digit' : undefined, hour12: !S.clock24 });
  const date = S.showDate ? d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '') + '  ' : '';
  $('clock').textContent = date + time;
  renderPomo();
}
setInterval(tick, 1000);

function renderPomo() {
  const el = $('pomo');
  if (!pomo) return el.classList.add('hidden');
  const left = Math.max(0, pomo.endsAt - Date.now());
  const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
  const frac = 1 - left / pomo.total;
  const R = 5.5, C = 2 * Math.PI * R;
  el.className = 'btn pomo num' + (pomo.mode === 'break' ? ' break' : '');
  el.innerHTML = `<svg class="ring" viewBox="0 0 14 14"><circle cx="7" cy="7" r="${R}" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/>
    <circle cx="7" cy="7" r="${R}" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" transform="rotate(-90 7 7)" stroke-linecap="round"/></svg>
    ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderStats(st) {
  const el = $('stats');
  if (!S.menubarShowStats || !st) return el.classList.add('hidden');
  el.classList.remove('hidden');
  el.innerHTML = `<span>CPU <b>${Math.round(st.cpu * 100)}%</b></span><span>RAM <b>${Math.round(st.mem * 100)}%</b></span>`;
}

let bat;
async function battery() {
  const el = $('bat');
  if (!S.showBattery || !navigator.getBattery) return el.classList.add('hidden');
  bat = bat || await navigator.getBattery();
  const draw = () => {
    if (!S.showBattery || (bat.charging && bat.level === 1 && bat.chargingTime === 0)) return el.classList.add('hidden');
    const pct = Math.round(bat.level * 100);
    const w = Math.max(1, Math.round(16 * bat.level));
    const fill = pct <= 20 && !bat.charging ? '#ff453a' : 'currentColor';
    el.innerHTML = `${pct}% <svg viewBox="0 0 23 12"><rect x=".5" y=".5" width="20" height="11" rx="3" fill="none" stroke="currentColor" opacity=".45"/><rect x="21.5" y="4" width="1.5" height="4" rx=".7" fill="currentColor" opacity=".45"/><rect x="2" y="2" width="${w}" height="8" rx="1.6" fill="${fill}"/>${bat.charging ? '<path d="M11 2.5 8 6.5h2.5L9.5 9.5l3-4H10z" fill="#fff" stroke="currentColor" stroke-width=".4"/>' : ''}</svg>`;
    el.classList.remove('hidden');
  };
  bat.onlevelchange = bat.onchargingchange = draw;
  draw();
}

const pos = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.bottom + 2) }; };
$('logo').addEventListener('click', (e) => window.lumen.barMenu(pos(e.currentTarget)));
$('label').addEventListener('click', () => window.lumen.openSettings());
$('pomo').addEventListener('click', (e) => window.lumen.pomoMenu(pos(e.currentTarget)));
$('cc').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); window.lumen.toggleControl(Math.round(r.right)); });
$('clock').addEventListener('click', () => window.lumen.togglePanel());

// Desktop virtuali
let desks = null;
function renderDesks() {
  const el = $('desks');
  if (!S.showDesktops || !desks) return el.classList.add('hidden');
  el.classList.remove('hidden');
  el.innerHTML = desks.ids.map((id, i) => `<span class="${i === desks.index ? 'on' : ''}" data-d="${i}">${i + 1}</span>`).join('');
}
$('desks').addEventListener('click', (e) => { const d = e.target.closest('[data-d]'); if (d) window.lumen.barDesktop(Number(d.dataset.d)); });
$('desks').addEventListener('contextmenu', (e) => { e.preventDefault(); window.lumen.barDesktopMenu(pos(e.currentTarget)); });
window.lumen.on('desktops', (d) => { desks = d; renderDesks(); });
window.lumen.desktopsGet().then(d => { if (d) { desks = d; renderDesks(); } });
$('stats').addEventListener('click', () => window.lumen.openSettings('barra'));

window.lumen.on('active-app', (a) => { active = a; renderLabel(); });
window.lumen.on('pomo', (p) => { pomo = p; renderPomo(); });
window.lumen.on('pomo-ding', () => { const c = $('clock'); c.classList.add('ding'); setTimeout(() => c.classList.remove('ding'), 1600); });
window.lumen.on('stats', renderStats);

// Barra a scomparsa: nascosta finché il mouse non tocca il bordo in alto
let barShown = true, barHideT = null;
function setBarShown(v) {
  barShown = v;
  $('bar').style.transform = v ? '' : 'translateY(-100%)';
  window.lumen.barMouse(v);
}
$('bar').style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)';
document.addEventListener('mousemove', (e) => {
  if (!S.menubarAutoHide) return;
  clearTimeout(barHideT);
  if (!barShown && e.clientY <= 2) setBarShown(true);
});
document.addEventListener('mouseleave', () => {
  if (!S.menubarAutoHide) return;
  clearTimeout(barHideT);
  barHideT = setTimeout(() => setBarShown(false), 700);
});

const LOGO_DEFAULT = $('logo').innerHTML;
App.init(async (s, first) => {
  S = s;
  // Con il tema Demoniaccio il logo diventa la "D"
  $('logo').innerHTML = s.skin === 'demoniaccio' ? '<img src="skins/demoniaccio/mark.png" style="height:17px;width:auto;display:block">' : LOGO_DEFAULT;
  if (first) { const st = await window.lumen.barState(); active = st.fg; pomo = st.pomo; renderStats(st.stats); }
  renderLabel(); tick(); battery(); renderDesks();
  if (S.menubarAutoHide && barShown) setBarShown(false);
  if (!S.menubarAutoHide && !barShown) { barShown = true; $('bar').style.transform = ''; } if (!S.menubarShowStats) renderStats(null);
});
