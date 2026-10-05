import './ui.js';
export async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.success) {
    const e = new Error((j && j.error && j.error.message) || 'Terjadi kesalahan. Coba lagi.');
    e.status = r.status;
    throw e;
  }
  return j.data;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
export async function needUser() {
  try { return await api('/auth/me'); } catch { location.href = '/masuk.html'; return new Promise(() => {}); }
}
export function topbar(el, user) {
  el.innerHTML = `<a class="logo" href="/dashboard.html"><i></i>Qwizen</a>
  <div class="row"><span class="muted">${esc(user.name)}</span><button class="btn soft sm" id="out">Keluar</button></div>`;
  el.querySelector('#out').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.href = '/'; };
}
