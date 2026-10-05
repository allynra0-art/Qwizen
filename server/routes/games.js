import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, fail, invalid } from '../auth.js';
import { createGame } from '../game/engine.js';

export const gamesRouter = Router();
gamesRouter.use(requireAuth);

gamesRouter.post('/', (req, res) => {
  const p = z.object({ quizId: z.number().int() }).safeParse(req.body);
  if (!p.success) return invalid(res, p.error);
  const r = createGame(req.user.id, p.data.quizId);
  if (r.error === 'QUIZ_NOT_FOUND') return fail(res, 404, 'QUIZ_NOT_FOUND', 'Kuis tidak ditemukan.');
  if (r.error === 'QUIZ_EMPTY') return fail(res, 400, 'QUIZ_EMPTY', 'Kuis ini belum punya soal. Tambahkan soal dulu.');
  res.status(201).json({ success: true, data: { pin: r.game.pin } });
});
