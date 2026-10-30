const root = $('#root');
const acts = {};
document.addEventListener('click', e => { const t = e.target.closest('[data-act]'); if (t) acts[t.dataset.act]?.(t.dataset, t); });
const quizUrl = slug => new URL('quiz.html?q=' + encodeURIComponent(slug), location.href).href;
const toLocal = d => d ? new Date(new Date(d) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const fail = (e, m) => { console.error(e); toast((m || 'Gagal') + ': ' + (e.message || e), true); };

// ---------- Autentikasi ----------
async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return loginView();
  const { data: ok, error } = await sb.rpc('is_admin');
  if (error || !ok) return root.innerHTML = `<div class="login"><div class="card"><h2>Akses ditolak</h2><p>Akun ini tidak terdaftar sebagai admin.</p><button class="btn" data-act="logout">Keluar</button></div></div>`;
  root.innerHTML = `<div class="admin"><aside><h2>Admin Kuis</h2>
    <a href="#/dashboard" data-nav="dashboard">Dashboard</a><a href="#/quizzes" data-nav="quizzes">Kuis</a><a href="#/results" data-nav="results">Hasil peserta</a>
    <a href="#" data-act="logout">Keluar</a></aside><main id="main"></main></div>`;
  route();
}
function loginView() {
  root.innerHTML = `<div class="login"><form class="card" id="lf"><h1>Masuk Admin</h1>
    <label for="em">Email</label><input id="em" type="email" autocomplete="username" required>
    <label for="pw">Kata sandi</label><input id="pw" type="password" autocomplete="current-password" required>
    <p class="err" id="lm" role="alert"></p><button class="btn" style="margin-top:12px">Masuk</button></form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) $('#lm').textContent = 'Email atau kata sandi salah.'; else boot();
  };
}
acts.logout = async () => { await sb.auth.signOut(); loginView(); };

// ---------- Router ----------
async function route() {
  const main = $('#main'); if (!main) return;
  const [, page = 'dashboard', arg] = location.hash.split('/');
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === page || (page === 'quiz' && a.dataset.nav === 'quizzes') || (page === 'attempt' && a.dataset.nav === 'results')));
  main.innerHTML = '<p class="muted">Memuat…</p>';
  try {
    if (page === 'quizzes') await quizList(main);
    else if (page === 'quiz') await quizEdit(main, arg);
    else if (page === 'results') await results(main);
    else if (page === 'attempt') await attemptDetail(main, arg);
    else await dashboard(main);
  } catch (e) { console.error(e); main.innerHTML = `<div class="card"><p class="err">Gagal memuat halaman: ${esc(e.message)}</p></div>`; }
}
window.addEventListener('hashchange', route);

// ---------- Dashboard ----------
async function dashboard(m) {
  const cnt = async (t, f) => { let q = sb.from(t).select('id', { count: 'exact', head: true }); if (f) q = f(q); const { count, error } = await q; if (error) throw error; return count; };
  const [qz, act, att, sub] = await Promise.all([cnt('quizzes'), cnt('quizzes', q => q.eq('is_active', true)), cnt('attempts'), cnt('attempts', q => q.eq('status', 'submitted'))]);
  const { data: recent } = await sb.from('attempts').select('id,name,institution,status,started_at,quizzes(title)').order('started_at', { ascending: false }).limit(8);
  m.innerHTML = `<h1>Dashboard</h1><div class="stats">
    <div class="card"><b>${qz}</b>Total kuis</div><div class="card"><b>${act}</b>Kuis aktif</div>
    <div class="card"><b>${att}</b>Percobaan dimulai</div><div class="card"><b>${sub}</b>Jawaban terkirim</div></div>
    <div class="card"><h2>Aktivitas terbaru</h2><div class="tbl"><table><tr><th>Nama</th><th>Institusi</th><th>Kuis</th><th>Mulai</th><th>Status</th></tr>
    ${(recent || []).map(r => `<tr><td><a href="#/attempt/${r.id}">${esc(r.name)}</a></td><td>${esc(r.institution)}</td><td>${esc(r.quizzes?.title)}</td><td>${fmtDT(r.started_at)}</td><td>${statusBadge(r.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Belum ada peserta.</td></tr>'}</table></div></div>`;
}
const statusBadge = s => s === 'submitted' ? '<span class="badge on">Terkirim</span>' : '<span class="badge warn">Belum kirim</span>';

// ---------- Daftar kuis ----------
async function quizList(m) {
  const { data, error } = await sb.from('quizzes').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  m.innerHTML = `<div class="row"><h1 class="grow">Kuis</h1><a class="btn" href="#/quiz/new">+ Kuis baru</a></div>
  <div class="card tbl"><table><tr><th>Judul</th><th>URL (slug)</th><th>Periode</th><th>Status</th><th>Aksi</th></tr>
  ${data.map(q => `<tr><td>${esc(q.title)}</td><td>${esc(q.slug)}</td><td>${fmtDT(q.starts_at)} – ${fmtDT(q.ends_at)}</td>
    <td>${q.is_active ? '<span class="badge on">Aktif</span>' : '<span class="badge">Nonaktif</span>'}</td>
    <td class="row"><a class="btn sm alt" href="#/quiz/${q.id}">Edit</a><button class="btn sm alt" data-act="copy" data-url="${esc(quizUrl(q.slug))}">Salin URL</button>
    <button class="btn sm danger" data-act="delq" data-id="${q.id}" data-title="${esc(q.title)}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Belum ada kuis. Klik “Kuis baru”.</td></tr>'}</table></div>`;
}
acts.copy = async d => { try { await navigator.clipboard.writeText(d.url); toast('URL disalin'); } catch { prompt('Salin URL ini:', d.url); } };
acts.delq = async d => {
  const { count } = await sb.from('attempts').select('id', { count: 'exact', head: true }).eq('quiz_id', d.id);
  if (!confirm(`Hapus kuis "${d.title}"?\nSemua pertanyaan dan ${count || 0} data peserta ikut terhapus permanen.`)) return;
  const { error } = await sb.from('quizzes').delete().eq('id', d.id);
  if (error) return fail(error); toast('Kuis dihapus'); route();
};

// ---------- Edit kuis + pertanyaan ----------
async function quizEdit(m, id) {
  const isNew = id === 'new';
  let q = { title: '', slug: '', description: '', duration_minutes: 10, starts_at: null, ends_at: null, is_active: false, allow_retake: false };
  if (!isNew) { const { data, error } = await sb.from('quizzes').select('*').eq('id', id).single(); if (error) throw error; q = data; }
  m.innerHTML = `<div class="row"><h1 class="grow">${isNew ? 'Kuis baru' : 'Edit kuis'}</h1><a href="#/quizzes">← Daftar kuis</a></div>
  <form id="qf" class="card"><div class="grid2">
    <div><label>Judul</label><input id="t" value="${esc(q.title)}" required></div>
    <div><label>Slug URL (huruf kecil, angka, tanda -)</label><input id="s" value="${esc(q.slug)}" pattern="[a-z0-9]+(-[a-z0-9]+)*" required></div></div>
    <label>Deskripsi</label><textarea id="d">${esc(q.description)}</textarea>
    <div class="grid2"><div><label>Durasi timer (menit)</label><input id="du" type="number" min="1" value="${q.duration_minutes}" required></div><div></div>
    <div><label>Dapat diakses mulai</label><input id="st" type="datetime-local" value="${toLocal(q.starts_at)}"></div>
    <div><label>Dapat diakses sampai</label><input id="en" type="datetime-local" value="${toLocal(q.ends_at)}"></div></div>
    <label><input type="checkbox" id="ac" ${q.is_active ? 'checked' : ''}> Kuis aktif</label>
    <label><input type="checkbox" id="rt" ${q.allow_retake ? 'checked' : ''}> Izinkan peserta (email sama) mengikuti lagi sebagai percobaan baru</label>
    <p class="muted">Kosongkan periode jika kuis tidak dibatasi waktu. Timer hanya penanda visual bagi peserta.</p>
    <button class="btn">Simpan kuis</button></form><div id="extra"></div>`;
  $('#qf').onsubmit = async e => {
    e.preventDefault();
    const row = { title: $('#t').value.trim(), slug: $('#s').value.trim().toLowerCase(), description: $('#d').value.trim(), duration_minutes: +$('#du').value,
      starts_at: $('#st').value ? new Date($('#st').value).toISOString() : null, ends_at: $('#en').value ? new Date($('#en').value).toISOString() : null,
      is_active: $('#ac').checked, allow_retake: $('#rt').checked };
    const r = isNew ? await sb.from('quizzes').insert(row).select('id').single() : await sb.from('quizzes').update(row).eq('id', id).select('id').single();
    if (r.error) return fail(r.error, r.error.code === '23505' ? 'Slug sudah dipakai kuis lain' : 'Gagal menyimpan');
    toast('Kuis disimpan'); if (isNew) location.hash = '#/quiz/' + r.data.id; else route();
  };
  if (isNew) return;
  const url = quizUrl(q.slug);
  $('#extra').innerHTML = `<div class="card"><h2>Tautan & QR code</h2><div class="urlbox"><input readonly value="${esc(url)}"><button class="btn alt" data-act="copy" data-url="${esc(url)}">Salin</button></div>
    <div id="qr" style="margin:14px 0"></div><button class="btn alt" data-act="qrdl" data-slug="${esc(q.slug)}">Unduh QR (PNG)</button></div>
    <div class="card" id="qs"></div>`;
  new QRCode($('#qr'), { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  await renderQuestions(id);
}
acts.qrdl = d => { const c = $('#qr canvas'); if (!c) return; const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'qr-' + d.slug + '.png'; a.click(); };

let QZ = null, QLIST = [];
async function renderQuestions(quizId) {
  QZ = quizId;
  const { data, error } = await sb.from('questions').select('id,position,text,options(id,position,text),answer_keys(option_id)').eq('quiz_id', quizId).order('position').order('id');
  if (error) throw error; QLIST = data;
  const key = q => (Array.isArray(q.answer_keys) ? q.answer_keys[0] : q.answer_keys)?.option_id;
  $('#qs').innerHTML = `<div class="row"><h2 class="grow">Pertanyaan (${data.length})</h2><button class="btn" data-act="qedit" data-id="">+ Tambah pertanyaan</button></div><div id="qed"></div>
  ${data.map((q, i) => `<div class="card" style="margin-top:12px"><div class="row"><b class="grow">${i + 1}. ${esc(q.text)}</b>
    <button class="btn sm alt" data-act="qmove" data-id="${q.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Naik">↑</button>
    <button class="btn sm alt" data-act="qmove" data-id="${q.id}" data-dir="1" ${i === data.length - 1 ? 'disabled' : ''} title="Turun">↓</button>
    <button class="btn sm alt" data-act="qedit" data-id="${q.id}">Edit</button><button class="btn sm danger" data-act="qdel" data-id="${q.id}">Hapus</button></div>
    ${[...q.options].sort((a, b) => a.position - b.position).map(o => `<div class="ans ${o.id === key(q) ? 'good' : ''}">${esc(o.text)} ${o.id === key(q) ? '<b>(benar)</b>' : ''}</div>`).join('')}</div>`).join('') || '<p class="muted">Belum ada pertanyaan.</p>'}`;
}
acts.qedit = d => {
  const q = QLIST.find(x => x.id === d.id) || { id: null, text: '', options: [{ text: '' }, { text: '' }], answer_keys: null };
  const k = (Array.isArray(q.answer_keys) ? q.answer_keys[0] : q.answer_keys)?.option_id;
  const opts = [...q.options].sort((a, b) => (a.position || 0) - (b.position || 0));
  const ci = Math.max(0, opts.findIndex(o => o.id === k));
  $('#qed').innerHTML = `<form class="card" id="qef" style="margin-top:12px"><h3>${q.id ? 'Edit' : 'Tambah'} pertanyaan</h3>
    <label>Teks pertanyaan</label><textarea id="qt" required>${esc(q.text)}</textarea>
    <label>Pilihan jawaban (pilih satu yang benar)</label><div id="ol"></div>
    <button type="button" class="btn sm alt" data-act="oadd">+ Pilihan</button>
    <div class="row" style="margin-top:14px"><button class="btn">Simpan pertanyaan</button><button type="button" class="btn alt" data-act="qcancel">Batal</button></div></form>`;
  opts.forEach((o, i) => addOpt(o.text, o.id, i === ci));
  $('#qef').onsubmit = async e => {
    e.preventDefault();
    const rows = [...document.querySelectorAll('.optrow')].map(r => ({ id: r.dataset.id || null, text: r.querySelector('input[type=text]').value.trim(), c: r.querySelector('input[type=radio]').checked }));
    if (rows.some(r => !r.text) || rows.length < 2) return toast('Minimal 2 pilihan dan semua terisi', true);
    const { error } = await sb.rpc('admin_save_question', { p_quiz_id: QZ, p_question_id: q.id, p_text: $('#qt').value.trim(), p_options: rows.map(r => ({ id: r.id, text: r.text })), p_correct: rows.findIndex(r => r.c) });
    if (error) return fail(error); toast('Pertanyaan disimpan'); renderQuestions(QZ);
  };
};
function addOpt(text = '', id = '', checked = false) {
  const r = document.createElement('div'); r.className = 'optrow'; r.dataset.id = id || '';
  r.innerHTML = `<input type="radio" name="correct" ${checked ? 'checked' : ''} title="Jawaban benar"><input type="text" value="${esc(text)}" placeholder="Teks pilihan"><button type="button" class="btn sm danger" data-act="orem">✕</button>`;
  $('#ol').appendChild(r); if (!document.querySelector('.optrow input[type=radio]:checked')) document.querySelector('.optrow input[type=radio]').checked = true;
}
acts.oadd = () => addOpt();
acts.orem = (d, t) => { if (document.querySelectorAll('.optrow').length <= 2) return toast('Minimal 2 pilihan', true); const wasC = t.parentNode.querySelector('input[type=radio]').checked; t.parentNode.remove(); if (wasC) document.querySelector('.optrow input[type=radio]').checked = true; };
acts.qcancel = () => { $('#qed').innerHTML = ''; };
acts.qdel = async d => {
  if (!confirm('Hapus pertanyaan ini? Jawaban peserta untuk pertanyaan ini ikut terhapus.')) return;
  const { error } = await sb.from('questions').delete().eq('id', d.id); if (error) return fail(error); renderQuestions(QZ);
};
acts.qmove = async d => {
  const i = QLIST.findIndex(q => q.id === d.id), j = i + +d.dir; if (j < 0 || j >= QLIST.length) return;
  const arr = [...QLIST]; [arr[i], arr[j]] = [arr[j], arr[i]];
  const res = await Promise.all(arr.map((q, n) => sb.from('questions').update({ position: n + 1 }).eq('id', q.id)));
  const e = res.find(r => r.error); if (e) return fail(e.error); renderQuestions(QZ);
};

// ---------- Hasil peserta ----------
// Halaman dibuka KOSONG; data baru diambil setelah filter diterapkan (hemat beban).
let RES = [], TOTAL = 0, F = { quiz: '', s: '', from: '', to: '' }, SHOWN = 50;
const durMs = r => new Date(r.submitted_at) - new Date(r.started_at);
const rank = (a, b) => {   // terkirim dulu: skor tertinggi, lalu tercepat; yang belum kirim di bawah
  const sa = a.status === 'submitted', sb2 = b.status === 'submitted';
  if (sa !== sb2) return sa ? -1 : 1;
  if (!sa) return new Date(b.started_at) - new Date(a.started_at);
  return (b.score - a.score) || (durMs(a) - durMs(b)) || (new Date(a.started_at) - new Date(b.started_at));
};
async function results(m) {
  RES = []; F = { quiz: '', s: '', from: '', to: '' };
  const { data: qs } = await sb.from('quizzes').select('id,title').order('title');
  m.innerHTML = `<h1>Hasil peserta</h1><div class="card"><div class="row">
    <select id="fq" class="grow"><option value="">Pilih kuis…</option>${(qs || []).map(q => `<option value="${q.id}">${esc(q.title)}</option>`).join('')}</select>
    <input id="fs" class="grow" placeholder="Cari nama / institusi / email">
    <label class="muted" style="margin:0">Dari <input id="ff" type="date" style="width:auto"></label>
    <label class="muted" style="margin:0">Sampai <input id="ft" type="date" style="width:auto"></label>
    <button class="btn" data-act="rfilter">Terapkan</button></div></div>
    <div class="card"><h2>Ekspor SQL (peringkat: skor tertinggi, lalu tercepat)</h2><div class="row">
    <label class="muted" style="margin:0">Quiz ID <input id="cqz" type="number" min="0" placeholder="mis. 15" style="width:110px"></label>
    <label class="muted" style="margin:0">Nama tabel tujuan <input id="ctb" placeholder="mis. quiz_participants" style="width:200px"></label>
    <label class="muted" style="margin:0">Nilai lulus (opsional) <input id="ckkm" type="number" min="0" max="100" style="width:100px"></label>
    <label class="muted" style="margin:0">Ambil N teratas (kosong = semua) <input id="ctop" type="number" min="1" style="width:100px"></label>
    <button class="btn alt" data-act="csv">Ekspor SQL</button></div>
    <p class="muted">Mengekspor data yang sedang dimuat (sesuai filter). Hanya peserta terkirim. session_token dibuat acak baru. is_passed = 1 bila skor ≥ nilai lulus, selain itu 0.</p></div>
    <div class="card tbl" id="rt"><p class="muted">Pilih kuis atau isi filter lain, lalu klik Terapkan untuk menampilkan data.</p></div>`;
  $('#fs').onkeydown = e => { if (e.key === 'Enter') acts.rfilter(); };
}
acts.rfilter = () => {
  F = { quiz: $('#fq').value, s: $('#fs').value.trim(), from: $('#ff').value, to: $('#ft').value };
  if (!F.quiz && !F.s && !F.from && !F.to) return toast('Pilih kuis atau isi minimal satu filter dulu', true);
  loadResults();
};
async function loadResults() {
  $('#rt').innerHTML = '<p class="muted">Memuat…</p>';
  let q = sb.from('attempts').select('id,name,institution,email,started_at,submitted_at,status,correct_count,total_questions,score,quizzes(title)', { count: 'exact' }).order('score', { ascending: false, nullsFirst: false }).order('started_at').limit(1000);
  if (F.quiz) q = q.eq('quiz_id', F.quiz);
  const s = F.s.replace(/[,()%*\\]/g, ' ').trim();
  if (s) q = q.or(`name.ilike.%${s}%,institution.ilike.%${s}%,email.ilike.%${s}%`);
  if (F.from) q = q.gte('started_at', new Date(F.from + 'T00:00:00').toISOString());
  if (F.to) q = q.lte('started_at', new Date(F.to + 'T23:59:59').toISOString());
  const { data, error, count } = await q; if (error) { $('#rt').innerHTML = ''; return fail(error); }
  RES = data.sort(rank); TOTAL = count ?? data.length; SHOWN = 50; renderRes();
}
function renderRes() {
  const sent = RES.filter(r => r.status === 'submitted').length;
  $('#rt').innerHTML = `<div class="row" style="margin-bottom:12px"><span class="badge">Total data: <b>${TOTAL}</b></span><span class="badge on">Terkirim: <b>${sent}</b></span><span class="badge warn">Belum kirim: <b>${RES.length - sent}</b></span></div><table><tr><th>#</th><th>Nama</th><th>Institusi</th><th>Email</th><th>Kuis</th><th>Mulai</th><th>Kirim</th><th>Durasi</th><th>Status</th><th>Benar</th><th>Skor</th><th></th></tr>
  ${RES.slice(0, SHOWN).map((r, k) => `<tr><td>${r.status === 'submitted' ? k + 1 : ''}</td><td>${esc(r.name)}</td><td>${esc(r.institution)}</td><td>${esc(r.email)}</td><td>${esc(r.quizzes?.title)}</td><td>${fmtDT(r.started_at)}</td><td>${fmtDT(r.submitted_at)}</td><td>${fmtDur(r.started_at, r.submitted_at)}</td><td>${statusBadge(r.status)}</td>
  <td>${r.status === 'submitted' ? r.correct_count + '/' + r.total_questions : '-'}</td><td>${r.score ?? '-'}</td><td><a href="#/attempt/${r.id}">Detail</a></td></tr>`).join('') || '<tr><td colspan="12" class="muted">Tidak ada data untuk filter ini.</td></tr>'}</table>
  <p class="muted">Menampilkan ${Math.min(SHOWN, RES.length)} dari ${RES.length} data.${TOTAL > RES.length ? ' Total ' + TOTAL + ' data, hanya ' + RES.length + ' teratas yang dimuat; persempit filter.' : ''}
  ${SHOWN < RES.length ? '<button class="btn sm alt" data-act="more">Tampilkan 50 lagi</button>' : ''}</p>`;
}
acts.more = () => { SHOWN += 50; renderRes(); };
acts.csv = () => {
  let list = RES.filter(r => r.status === 'submitted').sort(rank);
  const top = parseInt($('#ctop').value, 10); if (top > 0) list = list.slice(0, top);
  if (!list.length) return toast('Tampilkan data dulu lewat filter (harus ada peserta terkirim)', true);
  const qid = parseInt($('#cqz').value, 10), tbl = $('#ctb').value.trim();
  if (isNaN(qid)) return toast('Isi Quiz ID (angka)', true);
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(tbl)) return toast('Isi nama tabel tujuan yang valid', true);
  const kkm = $('#ckkm').value === '' ? null : +$('#ckkm').value;
  const q = v => "'" + String(v ?? '').replace(/[\\\r\n]+/g, ' ').replace(/'/g, "''") + "'";
  const ts = d => q(new Date(d).toISOString().slice(0, 19).replace('T', ' '));            // UTC, YYYY-MM-DD HH:MM:SS
  const vals = list.map(r => `(${qid}, ${q(r.name)}, ${q(r.institution)}, ${q(r.email)}, ${q(crypto.randomUUID())}, ${ts(r.started_at)}, ${ts(r.submitted_at)}, ${Number(r.score)}, ${kkm !== null && r.score >= kkm ? 1 : 0}, ${ts(r.started_at)}, ${ts(r.submitted_at)})`);
  const sql = `-- Ekspor hasil kuis (${list.length} peserta, urut skor tertinggi lalu tercepat)\nINSERT INTO ${tbl} (quiz_id, full_name, institution, email, session_token, started_at, finished_at, score, is_passed, created_at, updated_at) VALUES\n${vals.join(',\n')};\n`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([sql], { type: 'text/plain;charset=utf-8' })); a.download = 'hasil-kuis-quiz' + qid + '.sql'; a.click();
};

// ---------- Detail peserta ----------
async function attemptDetail(m, id) {
  const { data: a, error } = await sb.from('attempts').select('*,quizzes(title)').eq('id', id).single(); if (error) throw error;
  const [{ data: qs }, { data: an }] = await Promise.all([
    sb.from('questions').select('id,position,text,options(id,position,text),answer_keys(option_id)').eq('quiz_id', a.quiz_id).order('position').order('id'),
    sb.from('attempt_answers').select('question_id,option_id').eq('attempt_id', id)]);
  const pick = Object.fromEntries((an || []).map(x => [x.question_id, x.option_id]));
  m.innerHTML = `<div class="row"><h1 class="grow">Detail peserta</h1><a href="#/results">← Hasil</a></div>
  <div class="card"><div class="grid2"><p><b>Nama:</b> ${esc(a.name)}</p><p><b>Institusi:</b> ${esc(a.institution)}</p><p><b>Email:</b> ${esc(a.email)}</p><p><b>Kuis:</b> ${esc(a.quizzes?.title)}</p>
  <p><b>Mulai:</b> ${fmtDT(a.started_at)}</p><p><b>Kirim:</b> ${fmtDT(a.submitted_at)}</p><p><b>Durasi:</b> ${fmtDur(a.started_at, a.submitted_at)}</p><p><b>Status:</b> ${statusBadge(a.status)}</p>
  <p><b>Benar:</b> ${a.status === 'submitted' ? a.correct_count + '/' + a.total_questions : '-'}</p><p><b>Skor:</b> ${a.score ?? '-'}</p></div></div>
  ${qs.map((q, i) => { const k = (Array.isArray(q.answer_keys) ? q.answer_keys[0] : q.answer_keys)?.option_id;
    return `<div class="card"><b>${i + 1}. ${esc(q.text)}</b>${[...q.options].sort((x, y) => x.position - y.position).map(o => {
      const chosen = pick[q.id] === o.id, good = o.id === k;
      return `<div class="ans ${good ? 'good' : chosen ? 'bad' : ''}">${esc(o.text)} ${chosen ? '<b>← jawaban peserta</b>' : ''} ${good ? '<b>(kunci)</b>' : ''}</div>`; }).join('')}
    ${pick[q.id] ? '' : '<p class="muted">Tidak dijawab.</p>'}</div>`; }).join('')}`;
}

boot();
