const shot = document.getElementById('shot');
const ctx = shot.getContext('2d', { willReadFrequently: true });
const zoom = document.getElementById('zoom').getContext('2d');
const loupe = document.getElementById('loupe');
let ready = false, current = null;

function hexAt(x, y) {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

document.addEventListener('mousemove', (e) => {
  if (!ready) return;
  const sx = shot.width / window.innerWidth, sy = shot.height / window.innerHeight;
  const x = Math.round(e.clientX * sx), y = Math.round(e.clientY * sy);
  zoom.imageSmoothingEnabled = false;
  zoom.clearRect(0, 0, 11, 11);
  zoom.drawImage(shot, x - 5, y - 5, 11, 11, 0, 0, 11, 11);
  zoom.strokeStyle = 'rgba(255,255,255,.9)'; zoom.lineWidth = .12; zoom.strokeRect(5, 5, 1, 1);
  current = hexAt(x, y);
  document.getElementById('hex').textContent = current;
  document.getElementById('sw').style.background = current;
  loupe.style.display = 'block';
  const left = e.clientX + 24 + 132 > window.innerWidth ? e.clientX - 156 : e.clientX + 24;
  const top = e.clientY + 24 + 170 > window.innerHeight ? e.clientY - 190 : e.clientY + 24;
  loupe.style.left = left + 'px'; loupe.style.top = top + 'px';
});
document.addEventListener('click', () => { if (current) window.lumen.pickerDone(current); });
document.addEventListener('contextmenu', (e) => { e.preventDefault(); window.lumen.pickerDone(null); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.lumen.pickerDone(null); if (e.key === 'Enter' && current) window.lumen.pickerDone(current); });

window.lumen.on('picker-image', (src) => {
  const img = new Image();
  img.onload = () => { shot.width = img.width; shot.height = img.height; ctx.drawImage(img, 0, 0); ready = true; };
  img.src = src;
});
App.init(() => {});
