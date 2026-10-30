const app = $('#app');
const slug = (new URLSearchParams(location.search).get('q') || '').trim().toLowerCase();
const KEY = 'quiz:' + slug, AKEY = KEY + ':answers';
const DONE_MSG = 'Jawaban kamu sudah terkirim. Terima kasih telah berpartisipasi!';
const MSG = {
  QUIZ_NOT_FOUND: 'Kuis tidak ditemukan. Periksa kembali tautan atau QR code.',
  QUIZ_CLOSED: 'Kuis ini sedang tidak dibuka.',
  NO_QUESTIONS: 'Pertanyaan untuk kuis ini belum tersedia.',
  ALREADY_SUBMITTED: 'Email ini sudah pernah mengirim jawaban untuk kuis ini.',
  ATTEMPT_NOT_FOUND: 'Sesi pengerjaan tidak ditemukan. Silakan mulai ulang.',
  INVALID_INPUT: 'Data yang diisi belum lengkap atau tidak valid.'
};
const errMsg = e => {
  const k = Object.keys(MSG).find(k => (e?.message || '').includes(k));
  return k ? MSG[k] : (navigator.onLine ? 'Terjadi kesalahan. Coba lagi sebentar lagi.' : 'Tidak ada koneksi internet. Periksa koneksi lalu coba lagi.');
};
const view = h => { app.innerHTML = h; };
const store = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };
let timerId = null;

function showDone() { clearInterval(timerId); view(`<div class="card done"><h1>✓</h1><p>${DONE_MSG}</p></div>`); }
function showError(m, retry) {
  clearInterval(timerId);
  view(`<div class="card"><h2>Tidak dapat melanjutkan</h2><p class="err">${esc(m)}</p>${retry ? '<button class="btn" id="retry">Coba lagi</button>' : ''}</div>`);
  if (retry) $('#retry').onclick = init;
}

async function init() {
  if (!slug) return showError(MSG.QUIZ_NOT_FOUND);
  const st = store.get(KEY);
  if (st?.done) return showDone();
  try {
    if (st?.id) {
      const { data, error } = await sb.rpc('resume_attempt', { p_id: st.id, p_token: st.token });
      if (!error) return data.status === 'submitted' ? (store.set(KEY, { done: true }), showDone()) : runQuiz(data);
      if (error.message.includes('ATTEMPT_NOT_FOUND')) store.del(KEY); else throw error;
    }
    const { data, error } = await sb.rpc('get_quiz_public', { p_slug: slug });
    if (error) throw error;
    renderIntro(data);
  } catch (e) { showError(errMsg(e), !e.message?.includes('QUIZ_NOT_FOUND')); }
}

function renderIntro(q) {
  const closed = { inactive: 'Kuis ini belum dibuka.', not_started: 'Kuis akan dibuka pada ' + fmtDT(q.starts_at) + '.', ended: 'Periode kuis sudah berakhir.' }[q.status];
  document.title = q.title;
  view(`<div class="card"><h1>${esc(q.title)}</h1>
    <p>${esc(q.description).replace(/\n/g, '<br>')}</p>
    <p class="muted">${q.question_count} pertanyaan · durasi ${q.duration_minutes} menit</p></div>
    ${closed ? `<div class="card"><p class="err">${closed}</p></div>` : q.question_count === 0 ? `<div class="card"><p class="err">${MSG.NO_QUESTIONS}</p></div>` : `
    <form id="f" class="card" novalidate><h2>Data peserta</h2>
      <label for="n">Nama lengkap</label><input id="n" maxlength="150" autocomplete="name" required>
      <label for="i">Institusi / asal</label><input id="i" maxlength="200" autocomplete="organization" required>
      <label for="e">Email</label><input id="e" type="email" maxlength="254" autocomplete="email" required>
      <p class="err" id="m" role="alert"></p>
      <button class="btn" id="go" style="margin-top:14px">Mulai Kuis</button></form>`}`);
  const f = $('#f'); if (!f) return;
  f.onsubmit = async ev => {
    ev.preventDefault();
    const v = { p_slug: slug, p_name: $('#n').value.trim(), p_institution: $('#i').value.trim(), p_email: $('#e').value.trim() };
    if (!v.p_name || !v.p_institution || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.p_email)) { $('#m').textContent = 'Lengkapi nama, institusi, dan email yang valid.'; return; }
    $('#go').disabled = true; $('#m').textContent = '';
    const { data, error } = await sb.rpc('start_attempt', v);
    if (error) { $('#m').textContent = errMsg(error); $('#go').disabled = false; return; }
    store.set(KEY, { id: data.attempt_id, token: data.token }); store.del(AKEY);
    runQuiz(data);
  };
}

function runQuiz(p) {
  const ans = store.get(AKEY) || {};
  const Q = p.questions, N = Q.length;
  let i = Math.max(0, Q.findIndex(q => !ans[q.id]));            // lanjut dari soal yang belum dijawab
  const offset = new Date(p.server_now).getTime() - Date.now();   // selisih jam server vs perangkat
  const endAt = new Date(p.started_at).getTime() + p.duration_minutes * 60000;
  document.title = p.title; app.className = '';
  view(`<div class="timer" id="tb"><span>Sisa waktu</span><b id="tm">--:--</b></div>
    <div class="wrap qwrap"><div class="qhead"><span id="qn"></span><span class="muted" id="qa"></span></div>
      <div class="prog"><i id="pg"></i></div><div class="dots" id="dots"></div><div id="qv"></div><p class="err" id="m" role="alert"></p></div>
    <div class="navbar"><div class="navin"><button class="btn alt" id="prev">Sebelumnya</button><button class="btn" id="next">Selanjutnya</button></div></div>`);
  const draw = () => {
    const q = Q[i], done = Q.filter(x => ans[x.id]).length;
    $('#qn').textContent = `Soal ${i + 1} dari ${N}`; $('#qa').textContent = `${done} terjawab`;
    $('#pg').style.width = ((i + 1) / N * 100) + '%';
    $('#dots').innerHTML = Q.map((x, n) => `<button type="button" class="dot ${ans[x.id] ? 'ans' : ''} ${n === i ? 'cur' : ''}" data-n="${n}" aria-label="Soal ${n + 1}">${n + 1}</button>`).join('');
    $('#dots .cur')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    $('#qv').innerHTML = `<div class="card q"><p>${esc(q.text)}</p>${q.options.map(o => `
      <label class="opt"><input type="radio" name="q" value="${o.id}" ${ans[q.id] === o.id ? 'checked' : ''}><span>${esc(o.text)}</span></label>`).join('')}</div>`;
    $('#prev').disabled = i === 0;
    $('#next').textContent = i === N - 1 ? 'Kirim Jawaban' : 'Selanjutnya';
    $('#m').textContent = ''; window.scrollTo(0, 0);
  };
  const tick = () => {
    const rem = endAt - (Date.now() + offset), s = Math.max(0, Math.ceil(rem / 1000));
    $('#tm').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    if (rem <= 0) { $('#tb').classList.add('over'); $('#tb').firstElementChild.textContent = 'Waktu habis, kamu masih bisa mengirim'; }
  };
  app.onchange = e => { if (e.target.name === 'q') { ans[Q[i].id] = e.target.value; store.set(AKEY, ans); $('#qa').textContent = Q.filter(x => ans[x.id]).length + ' terjawab'; $(`#dots [data-n="${i}"]`).classList.add('ans'); } };
  app.onclick = e => { const d = e.target.closest('.dot'); if (d) { i = +d.dataset.n; draw(); } };
  $('#prev').onclick = () => { if (i > 0) { i--; draw(); } };
  $('#next').onclick = async () => {
    if (i < N - 1) { i++; draw(); return; }
    const left = Q.filter(q => !ans[q.id]).length;
    if (left && !confirm(left + ' soal belum dijawab. Tetap kirim?')) return;
    const btn = $('#next'); btn.disabled = true; $('#prev').disabled = true; $('#m').textContent = '';
    const st = store.get(KEY);
    const { error } = await sb.rpc('submit_attempt', { p_id: st.id, p_token: st.token, p_answers: Q.filter(q => ans[q.id]).map(q => ({ question_id: q.id, option_id: ans[q.id] })) });
    if (error) { $('#m').textContent = 'Jawaban belum terkirim. ' + errMsg(error); btn.disabled = false; $('#prev').disabled = false; return; }
    store.set(KEY, { done: true }); store.del(AKEY); app.onchange = app.onclick = null; app.className = 'wrap'; showDone();
  };
  draw(); tick(); clearInterval(timerId); timerId = setInterval(tick, 1000);
}
init();
