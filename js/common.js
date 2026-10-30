const sb = supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDT = d => d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
const fmtDur = (a, b) => { if (!a || !b) return '-'; const s = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)); return Math.floor(s / 60) + ' mnt ' + (s % 60) + ' dtk'; };
function toast(msg, bad) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
}
