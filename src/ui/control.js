const $ = (id) => document.getElementById(id);
const I = window.ICONS;
let st = {}, radios = null, media = null, mediaTimer = null, pomo = null;

$('wifi').querySelector('.circle').innerHTML = App.icon('wifi');
$('bt').querySelector('.circle').innerHTML = App.icon('bluetooth');
$('dnd2').querySelector('.circle').innerHTML = App.icon('bellOff');
$('dark').querySelector('.circle').innerHTML = App.icon('contrast');
$('dnd').querySelector('.circle').innerHTML = App.icon('bellOff');
$('brIco').innerHTML = App.icon('brightness');
$('art').innerHTML = App.icon('music');
$('bPrev').innerHTML = App.icon('prev');
$('bNext').innerHTML = App.icon('next');

const QUICK = { snapshot: ['screenshot', 'cc.screenshot'], desktop: ['desktop', 'cc.desktop'], lock: ['lock', 'cc.lock'] };

function renderStatic() {
  document.querySelectorAll('[data-a]').forEach(el => { const [ic, k] = QUICK[el.dataset.a]; el.innerHTML = App.icon(ic) + `<span>${App.esc(t(k))}</span>`; });
  renderFocus();
}

function renderFocus() {
  const el = $('focus');
  el.classList.toggle('on', !!pomo);
  let label = t('cc.focus');
  if (pomo) { const left = Math.max(0, pomo.endsAt - Date.now()); label = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`; }
  el.innerHTML = App.icon('timer') + `<span>${App.esc(label)}</span>`;
}
setInterval(() => { if (pomo) renderFocus(); }, 1000);

function setRange(el, v) { el.value = v; el.style.setProperty('--p', v + '%'); }

function render() {
  // Radio (nascoste se il PC non le ha)
  const hasWifi = radios && radios.wifi !== null, hasBt = radios && radios.bluetooth !== null;
  $('wifi').classList.toggle('hidden', !hasWifi);
  $('bt').classList.toggle('hidden', !hasBt);
  if (hasWifi) { $('wifi').classList.toggle('on', radios.wifi); $('wifi').querySelector('small').textContent = radios.wifi ? (radios.ssid || t('cc.on')) : t('cc.off'); }
  if (hasBt) { $('bt').classList.toggle('on', radios.bluetooth); $('bt').querySelector('small').textContent = radios.bluetooth ? t('cc.on') : t('cc.off'); }
  // Senza radio, il riquadro grande mostra Non disturbare e la colonna mostra solo il tema scuro
  const noRadios = !hasWifi && !hasBt;
  $('dnd2').classList.toggle('hidden', !noRadios);
  $('dnd').classList.toggle('hidden', noRadios);
  $('dnd2').querySelector('small').textContent = st.dnd ? t('cc.on') : t('cc.off');

  $('dark').classList.toggle('on', !!st.dark);
  $('dnd').classList.toggle('on', !!st.dnd);
  $('dnd2').classList.toggle('on', !!st.dnd);

  if (st.vol) {
    setRange($('vol'), Math.round(st.vol.level * 100));
    $('muteBtn').innerHTML = App.icon(st.vol.muted || st.vol.level === 0 ? 'mute' : 'volume');
  }
  $('brightCard').classList.toggle('hidden', st.bright === null || st.bright === undefined);
  if (st.bright !== null && st.bright !== undefined) setRange($('bright'), st.bright);

  $('mediaCard').classList.toggle('hidden', !media || !media.title);
  if (media && media.title) {
    $('mTitle').textContent = media.title;
    $('mArtist').textContent = media.artist || media.app || '';
    $('bPlay').innerHTML = App.icon(media.playing ? 'pause' : 'play');
  }
  renderFocus();
  requestAnimationFrame(() => window.lumen.ccSize(document.getElementById('panel').getBoundingClientRect().height + 24));
}

async function load() {
  st = await window.lumen.ccState();
  pomo = st.pomo;
  render();
  window.lumen.ccRadios().then(r => { radios = r; render(); });
  window.lumen.ccBright().then(b => { st.bright = b; render(); });
  pollMedia();
}
async function pollMedia() {
  clearTimeout(mediaTimer);
  media = await window.lumen.ccMedia();
  render();
  if (document.hasFocus()) mediaTimer = setTimeout(pollMedia, 2500);
}

function toggle(id, key, field) {
  $(id).addEventListener('click', () => {
    const v = field === 'radio' ? !radios[key] : !st[key];
    if (field === 'radio') radios[key] = v; else st[key] = v;
    render();
    window.lumen.ccSet(key === 'bluetooth' ? 'bluetooth' : key, v);
    if (field === 'radio') setTimeout(() => window.lumen.ccRadios().then(r => { if (r) { radios = r; render(); } }), 1500);
  });
}
toggle('wifi', 'wifi', 'radio');
toggle('bt', 'bluetooth', 'radio');
toggle('dark', 'dark');
toggle('dnd', 'dnd');
toggle('dnd2', 'dnd');

let volT;
$('vol').addEventListener('input', (e) => {
  const v = +e.target.value; setRange(e.target, v);
  if (st.vol) { st.vol.level = v / 100; if (st.vol.muted && v > 0) { st.vol.muted = false; window.lumen.ccSet('mute', false); } }
  $('muteBtn').innerHTML = App.icon(v === 0 ? 'mute' : 'volume');
  clearTimeout(volT); volT = setTimeout(() => window.lumen.ccSet('volume', v / 100), 30);
});
$('muteBtn').addEventListener('click', () => { if (!st.vol) return; st.vol.muted = !st.vol.muted; window.lumen.ccSet('mute', st.vol.muted); render(); });
let brT;
$('bright').addEventListener('input', (e) => { setRange(e.target, +e.target.value); clearTimeout(brT); brT = setTimeout(() => window.lumen.ccSet('brightness', +e.target.value), 80); });

document.querySelectorAll('.ctl button').forEach(b => b.addEventListener('click', () => {
  window.lumen.ccSet('media', b.dataset.k);
  if (b.dataset.k === 'play' && media) { media.playing = !media.playing; render(); }
  setTimeout(pollMedia, 700);
}));
document.querySelectorAll('[data-a]').forEach(el => el.addEventListener('click', () => window.lumen.ccSet(el.dataset.a)));
$('focus').addEventListener('click', () => window.lumen.ccSet('pomo', pomo ? null : 'focus'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.blur(); });

// --- Profili ---
const PROFILES = [['work', 'layout'], ['game', 'play'], ['battery', 'power'], ['live', 'screenshot']];
function renderProfiles() {
  const active = App.S.activeProfile;
  $('profiles').innerHTML = PROFILES.map(([id, ic]) => `<button data-p="${id}" class="${active === id ? 'on' : ''}">${App.icon(ic)}${App.esc(t('prof.' + id))}</button>`).join('');
}
$('profiles').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-p]'); if (!b) return;
  const id = App.S.activeProfile === b.dataset.p ? null : b.dataset.p; // secondo clic = torna come prima
  b.style.opacity = .5;
  await window.lumen.profileApply(id);
  b.style.opacity = '';
});

// --- OBS ---
let obsT = null;
async function loadObs() {
  clearTimeout(obsT);
  const s = await window.lumen.obsStatus();
  const card = $('obsCard');
  card.classList.toggle('hidden', !s.enabled);
  if (!s.enabled) return render();
  const st = $('obsState');
  if (!s.connected) {
    st.className = 'obs-state'; st.textContent = t(s.error === 'password' ? 'obs.password' : 'obs.offline');
    $('obsStream').parentElement.classList.add('hidden'); $('obsScenes').innerHTML = '';
  } else {
    $('obsStream').parentElement.classList.remove('hidden');
    st.className = 'obs-state' + (s.streaming ? ' live' : '');
    st.textContent = s.streaming ? '● LIVE ' + (s.streamTime || '').slice(0, 8) : (s.recording ? '● REC' : t('obs.ready'));
    $('obsStream').textContent = t(s.streaming ? 'obs.stopStream' : 'obs.startStream'); $('obsStream').classList.toggle('on', s.streaming);
    $('obsRec').textContent = t(s.recording ? 'obs.stopRec' : 'obs.startRec'); $('obsRec').classList.toggle('on', s.recording);
    $('obsScenes').innerHTML = (s.scenes || []).map(n => `<button data-scene="${App.esc(n)}" class="${n === s.scene ? 'on' : ''}">${App.esc(n)}</button>`).join('');
  }
  render();
  if (document.hasFocus()) obsT = setTimeout(loadObs, 3000);
}
$('obsStream').onclick = () => window.lumen.obsAction('stream').then(() => setTimeout(loadObs, 600));
$('obsRec').onclick = () => window.lumen.obsAction('record').then(() => setTimeout(loadObs, 600));
$('obsScenes').addEventListener('click', (e) => { const b = e.target.closest('[data-scene]'); if (b) window.lumen.obsAction('scene', b.dataset.scene).then(loadObs); });
window.lumen.on('obs-changed', () => { if (document.hasFocus()) loadObs(); });

window.lumen.on('control-open', () => {
  renderProfiles(); loadObs(); const p = $('panel'); p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); load(); });
window.lumen.on('pomo', (p) => { pomo = p; renderFocus(); });
window.addEventListener('blur', () => clearTimeout(mediaTimer));

App.init(() => { renderStatic(); renderProfiles(); render(); });
