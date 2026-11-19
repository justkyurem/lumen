const $ = (id) => document.getElementById(id);
const ACCENTS = ['#0a84ff', '#bf5af2', '#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#8e8e93'];
const SUGGEST = /^(google chrome|firefox|microsoft edge|spotify|discord|visual studio code|telegram|whatsapp|steam|word|excel|powerpoint|outlook|teams|slack|notion|obs studio|vlc|esplora file|file explorer|blocco note|notepad|calcolatrice|calculator|foto|photos|figma|zoom)$/i;
let S = {}, step = 0, installed = null;
const chosen = new Set();

$('accent').innerHTML = ACCENTS.map(c => `<button data-c="${c}" style="background:${c}"></button>`).join('');
$('accent').addEventListener('click', (e) => { if (e.target.dataset.c) window.lumen.update({ accent: e.target.dataset.c }); });
$('themes').addEventListener('click', (e) => { const c = e.target.closest('[data-v]'); if (c) window.lumen.update({ theme: c.dataset.v }); });
$('lang').addEventListener('click', (e) => { if (e.target.dataset.v) window.lumen.update({ lang: e.target.dataset.v }); });
$('login').addEventListener('change', (e) => window.lumen.update({ launchAtLogin: e.target.checked }));

async function loadApps() {
  if (installed) return;
  $('appList').innerHTML = `<div class="hint" style="padding:20px">${App.esc(t('w.loading'))}</div>`;
  const have = new Set(S.apps.map(a => a.path));
  installed = (await window.lumen.installedApps()).filter(a => !have.has(a.path));
  installed.sort((a, b) => (SUGGEST.test(b.name) ? 1 : 0) - (SUGGEST.test(a.name) ? 1 : 0) || a.name.localeCompare(b.name));
  installed.filter(a => SUGGEST.test(a.name)).slice(0, 6).forEach(a => chosen.add(a.path));
  drawApps();
}
function drawApps() {
  window.AppPicker.renderAppList($('appList'), installed, chosen, count, $('appSearch').value);
  count();
}
function count() { $('appCount').textContent = t('ob.appCount', { n: chosen.size }); }
$('appSearch').addEventListener('input', drawApps);

function go(n) {
  if (n > 3) return finish();
  step = Math.max(0, n);
  document.querySelectorAll('.step').forEach(s => {
    const i = Number(s.dataset.s);
    s.classList.toggle('on', i === step);
    s.classList.toggle('past', i < step);
  });
  document.querySelectorAll('#dots i').forEach((d, i) => d.classList.toggle('on', i === step));
  $('back').style.visibility = step === 0 ? 'hidden' : 'visible';
  $('next').textContent = t(step === 3 ? 'ob.start' : 'ob.next');
  if (step === 2) loadApps();
}

function finish() {
  if (installed && chosen.size) {
    const add = installed.filter(a => chosen.has(a.path)).map(a => ({
      id: Math.random().toString(36).slice(2, 10), type: 'app', name: a.name, path: a.path, iconSrc: a.iconSrc || undefined, exe: a.exe || undefined,
    }));
    window.lumen.update({ apps: [...S.apps, ...add] });
  }
  window.lumen.onboardingDone();
}

$('next').onclick = () => go(step + 1);
$('back').onclick = () => go(step - 1);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && document.activeElement.tagName !== 'INPUT') go(step + 1); });

App.init((s) => {
  S = s;
  $('lang').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === s.lang));
  document.querySelectorAll('#themes .tcard').forEach(c => c.classList.toggle('on', c.dataset.v === s.theme));
  $('accent').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === s.accent));
  $('login').checked = !!s.launchAtLogin;
  if (installed) count();
  go(step);
});
