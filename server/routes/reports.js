import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, fail } from '../auth.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

function dist(q, as) {
  if (q.type === 'MULTIPLE_CHOICE') return q.options.map((t, i) => ({ label: t, count: as.filter((a) => a.answer === i).length, correct: i === q.correct }));
  if (q.type === 'TRUE_FALSE') return [true, false].map((v) => ({ label: v ? 'Benar' : 'Salah', count: as.filter((a) => a.answer === v).length, correct: q.correct === v }));
  return [{ label: `Benar (${q.answers[0]})`, count: as.filter((a) => a.is_correct).length, correct: true },
    { label: 'Salah', count: as.filter((a) => !a.is_correct).length, correct: false }];
}

function build(id, userId) {
  const s = db.prepare('SELECT id, quiz_title, questions_json, ended_at FROM game_sessions WHERE id = ? AND host_id = ?').get(id, userId);
  if (!s) return null;
  const qs = JSON.parse(s.questions_json);
  const players = db.prepare('SELECT id, nickname, score FROM players WHERE session_id = ? ORDER BY score DESC, id').all(id);
  const ans = db.prepare('SELECT a.player_id, a.q_index, a.is_correct, a.response_ms, a.points, a.answer FROM answers a JOIN players p ON p.id = a.player_id WHERE p.session_id = ?')
    .all(id).map((a) => ({ ...a, answer: JSON.parse(a.answer) }));
  const avg = (arr, f) => (arr.length ? Math.round(arr.reduce((t, x) => t + f(x), 0) / arr.length) : 0);
  const questions = qs.map((q, i) => {
    const as = ans.filter((a) => a.q_index === i), ok = as.filter((a) => a.is_correct).length;
    return { index: i, text: q.text, type: q.type, answered: as.length, unanswered: players.length - as.length,
      correctPct: players.length ? Math.round((ok / players.length) * 100) : 0, avgMs: avg(as, (a) => a.response_ms), distribution: dist(q, as) };
  });
  return { id: s.id, title: s.quiz_title, endedAt: s.ended_at, playerCount: players.length,
    avgScore: avg(players, (p) => p.score), questions,
    players: players.map((p, i) => {
      const mine = ans.filter((a) => a.player_id === p.id);
      return { rank: i + 1, nickname: p.nickname, score: p.score, correct: mine.filter((a) => a.is_correct).length, answered: mine.length,
        avgMs: avg(mine, (a) => a.response_ms), perQuestion: qs.map((_, k) => { const a = mine.find((x) => x.q_index === k); return a ? a.points : null; }) };
    }) };
}

reportsRouter.get('/', (req, res) => {
  const rows = db.prepare(`SELECT g.id, g.quiz_title AS title, g.ended_at AS endedAt,
    (SELECT COUNT(*) FROM players WHERE session_id = g.id) AS playerCount
    FROM game_sessions g WHERE g.host_id = ? AND g.ended_at IS NOT NULL ORDER BY g.id DESC LIMIT 50`).all(req.user.id);
  res.json({ success: true, data: rows });
});

reportsRouter.get('/:id', (req, res) => {
  const r = build(Number(req.params.id), req.user.id);
  if (!r) return fail(res, 404, 'REPORT_NOT_FOUND', 'Laporan tidak ditemukan.');
  res.json({ success: true, data: r });
});

// Sel yang diawali = + - @ diberi tanda ' agar tidak dibaca sebagai rumus oleh Excel.
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

reportsRouter.get('/:id/export', (req, res) => {
  const r = build(Number(req.params.id), req.user.id);
  if (!r) return fail(res, 404, 'REPORT_NOT_FOUND', 'Laporan tidak ditemukan.');
  const head = ['Peringkat', 'Nama', 'Skor', 'Benar', 'Dijawab', 'Rata-rata waktu (detik)', ...r.questions.map((q) => `Soal ${q.index + 1} (poin)`)];
  const rows = r.players.map((p) => [p.rank, p.nickname, p.score, p.correct, p.answered, (p.avgMs / 1000).toFixed(1), ...p.perQuestion.map((x) => (x === null ? '-' : x))]);
  const csv = '\uFEFF' + [head, ...rows].map((l) => l.map(cell).join(',')).join('\r\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="laporan-${r.id}.csv"` }).send(csv);
});
