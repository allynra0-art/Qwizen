const KEY = 'qwizen_prefs';
const prefs = { dark: null, eco: false, sound: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isEco = () => prefs.eco || reduced();
function apply() {
  const r = document.documentElement;
  if (prefs.dark === null) r.removeAttribute('data-theme'); else r.dataset.theme = prefs.dark ? 'dark' : 'light';
  r.classList.toggle('eco', isEco());
}
apply();

let ctx;
const TONES = { tick: [[660, .08]], ok: [[660, .1], [880, .18]], bad: [[220, .3]], win: [[523, .15], [659, .15], [784, .35]] };
export function beep(kind) {
  if (!prefs.sound) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    let t = ctx.currentTime;
    for (const [f, d] of TONES[kind]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; g.gain.setValueAtTime(.08, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d); t += d;
    }
  } catch {}
}
export function confetti(el) {
  if (isEco()) return;
  const c = ['#8B7CF6', '#7FD1B9', '#FFB48A', '#F6D675', '#F29BAB'];
  el.innerHTML = Array.from({ length: 26 }, (_, i) =>
    `<span style="left:${Math.round(Math.random() * 100)}%;background:${c[i % 5]};animation-delay:${(Math.random() * 1.2).toFixed(2)}s"></span>`).join('');
}
export function settings(el) {
  const defs = [['dark', 'Gelap', () => (prefs.dark === null ? matchMedia('(prefers-color-scheme: dark)').matches : prefs.dark)],
    ['eco', 'Mode Hemat', () => prefs.eco], ['sound', 'Suara', () => prefs.sound]];
  const draw = () => {
    el.innerHTML = defs.map(([k, l, get]) => `<button class="btn soft sm" data-k="${k}" aria-pressed="${get()}">${l}</button>`).join('');
  };
  el.onclick = (e) => {
    const k = e.target.dataset.k; if (!k) return;
    prefs[k] = k === 'dark' ? !defs[0][2]() : !prefs[k];
    save(); apply(); draw(); if (k === 'sound') beep('ok');
  };
  draw();
}
