export const GRACE_MS = 1000; // toleransi latensi jaringan
export const MAX_STREAK_BONUS = 500;

export const isLate = (responseMs, timeLimitMs) => responseMs > timeLimitMs + GRACE_MS;

// Jawaban benar? answer dikirim klien, kunci jawaban hanya ada di server.
export function checkAnswer(q, answer) {
  if (q.type === 'MULTIPLE_CHOICE') return typeof answer === 'number' && answer === q.correct;
  if (q.type === 'TRUE_FALSE') return typeof answer === 'boolean' && answer === q.correct;
  if (typeof answer !== 'string') return false;
  const n = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return q.answers.some((a) => n(a) === n(answer));
}

// poin = round(basePoin * (1 - (waktu / batas) / 2)) + bonus streak, minimum 0
export function scoreAnswer({ correct, responseMs, timeLimitMs, basePoints, streakBefore }) {
  if (!correct) return { points: 0, streak: 0 };
  if (basePoints <= 0) return { points: 0, streak: streakBefore + 1 };
  const t = Math.min(Math.max(responseMs, 0), timeLimitMs);
  const base = Math.round(basePoints * (1 - t / timeLimitMs / 2));
  const bonus = Math.min(streakBefore * 100, MAX_STREAK_BONUS);
  return { points: Math.max(0, base + bonus), streak: streakBefore + 1 };
}
