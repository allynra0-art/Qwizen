import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, fail, invalid } from '../auth.js';
import { quizInputSchema } from '../schemas.js';

export const quizzesRouter = Router();
quizzesRouter.use(requireAuth);

const toData = (q) =>
  q.type === 'MULTIPLE_CHOICE' ? { options: q.options, correct: q.correct }
  : q.type === 'TRUE_FALSE' ? { correct: q.correct }
  : { answers: q.answers };

function loadQuiz(id) {
  const quiz = db.prepare('SELECT id, title, description, updated_at AS updatedAt FROM quizzes WHERE id = ?').get(id);
  const rows = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position').all(id);
  quiz.questions = rows.map((r) => ({
    id: r.id, type: r.type, text: r.text, timeLimit: r.time_limit,
    points: r.points, explanation: r.explanation, ...JSON.parse(r.data),
  }));
  return quiz;
}

// Hanya pemilik yang boleh mengakses kuis. 404 (bukan 403) agar ID kuis orang lain tidak bocor.
function owned(req, res) {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) && db.prepare('SELECT id FROM quizzes WHERE id = ? AND owner_id = ?').get(id, req.user.id);
  if (!row) { fail(res, 404, 'QUIZ_NOT_FOUND', 'Kuis tidak ditemukan.'); return null; }
  return row.id;
}

function saveQuestions(quizId, questions) {
  db.prepare('DELETE FROM questions WHERE quiz_id = ?').run(quizId);
  const ins = db.prepare(
    'INSERT INTO questions (quiz_id, type, text, time_limit, points, position, explanation, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  questions.forEach((q, i) => ins.run(quizId, q.type, q.text, q.timeLimit, q.points, i, q.explanation, JSON.stringify(toData(q))));
}

quizzesRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT q.id, q.title, q.description, q.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS questionCount
    FROM quizzes q WHERE q.owner_id = ? ORDER BY q.updated_at DESC`).all(req.user.id);
  res.json({ success: true, data: rows });
});

quizzesRouter.post('/', (req, res) => {
  const p = quizInputSchema.safeParse(req.body);
  if (!p.success) return invalid(res, p.error);
  const id = db.transaction(() => {
    const newId = Number(db.prepare('INSERT INTO quizzes (owner_id, title, description) VALUES (?, ?, ?)')
      .run(req.user.id, p.data.title, p.data.description).lastInsertRowid);
    saveQuestions(newId, p.data.questions);
    return newId;
  })();
  res.status(201).json({ success: true, data: loadQuiz(id) });
});

quizzesRouter.get('/:id', (req, res) => {
  const id = owned(req, res);
  if (id) res.json({ success: true, data: loadQuiz(id) });
});

quizzesRouter.put('/:id', (req, res) => {
  const id = owned(req, res);
  if (!id) return;
  const p = quizInputSchema.safeParse(req.body);
  if (!p.success) return invalid(res, p.error);
  db.transaction(() => {
    db.prepare('UPDATE quizzes SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(p.data.title, p.data.description, id);
    saveQuestions(id, p.data.questions);
  })();
  res.json({ success: true, data: loadQuiz(id) });
});

quizzesRouter.delete('/:id', (req, res) => {
  const id = owned(req, res);
  if (!id) return;
  db.prepare('DELETE FROM quizzes WHERE id = ?').run(id);
  res.json({ success: true, data: null });
});
