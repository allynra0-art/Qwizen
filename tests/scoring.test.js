import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAnswer, checkAnswer, isLate } from '../server/game/scoring.js';

const base = { correct: true, timeLimitMs: 20000, basePoints: 1000, streakBefore: 0 };

test('jawaban benar dan sangat cepat ≈ poin penuh', () => assert.equal(scoreAnswer({ ...base, responseMs: 0 }).points, 1000));
test('jawaban benar di detik terakhir = separuh poin', () => assert.equal(scoreAnswer({ ...base, responseMs: 20000 }).points, 500));
test('jawaban cepat lebih tinggi dari lambat', () =>
  assert.ok(scoreAnswer({ ...base, responseMs: 2000 }).points > scoreAnswer({ ...base, responseMs: 15000 }).points));
test('jawaban salah = 0 poin dan streak reset', () =>
  assert.deepEqual(scoreAnswer({ ...base, correct: false, responseMs: 1000, streakBefore: 3 }), { points: 0, streak: 0 }));
test('bonus streak +100 per jawaban benar beruntun', () => {
  const r = scoreAnswer({ ...base, responseMs: 0, streakBefore: 2 });
  assert.equal(r.points, 1200); assert.equal(r.streak, 3);
});
test('bonus streak maksimal +500', () => assert.equal(scoreAnswer({ ...base, responseMs: 0, streakBefore: 20 }).points, 1500));
test('soal 0 poin tidak memberi poin', () => assert.equal(scoreAnswer({ ...base, basePoints: 0, responseMs: 0, streakBefore: 4 }).points, 0));
test('timeout: lewat batas + toleransi ditolak', () => {
  assert.equal(isLate(20500, 20000), false); assert.equal(isLate(21001, 20000), true);
});
test('waktu di dalam toleransi dihitung sebagai batas waktu (maks. kena penalti)', () =>
  assert.equal(scoreAnswer({ ...base, responseMs: 20800 }).points, 500));

test('checkAnswer pilihan ganda, benar/salah, isian', () => {
  assert.equal(checkAnswer({ type: 'MULTIPLE_CHOICE', correct: 2 }, 2), true);
  assert.equal(checkAnswer({ type: 'MULTIPLE_CHOICE', correct: 2 }, '2'), false);
  assert.equal(checkAnswer({ type: 'TRUE_FALSE', correct: false }, false), true);
  assert.equal(checkAnswer({ type: 'TYPE_ANSWER', answers: ['Merkurius'] }, '  merkurius '), true);
  assert.equal(checkAnswer({ type: 'TYPE_ANSWER', answers: ['Merkurius'] }, 'venus'), false);
});
