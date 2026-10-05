import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { userFromCookieHeader } from '../auth.js';
import { joinSchema, answerSchema, hostJoinSchema, reconnectSchema } from '../schemas.js';
import { checkAnswer, scoreAnswer, isLate, GRACE_MS } from './scoring.js';

const games = new Map(); // pin -> game (state live di memori)
const MAX_PLAYERS = 200;
const RECONNECT_MS = 30_000; // jendela sambung ulang pemain

export function createGame(hostId, quizId) {
  const quiz = db.prepare('SELECT id, title FROM quizzes WHERE id = ? AND owner_id = ?').get(quizId, hostId);
  if (!quiz) return { error: 'QUIZ_NOT_FOUND' };
  const questions = db.prepare('SELECT id, type, text, time_limit, points, explanation, data FROM questions WHERE quiz_id = ? ORDER BY position')
    .all(quizId).map((r) => ({ id: r.id, type: r.type, text: r.text, timeLimit: r.time_limit, points: r.points, explanation: r.explanation, ...JSON.parse(r.data) }));
  if (!questions.length) return { error: 'QUIZ_EMPTY' };
  let pin;
  do { pin = String(randomInt(100000, 1000000)); } while (games.has(pin));
  const game = { pin, hostId, quizId, title: quiz.title, questions, status: 'WAITING', index: -1,
    players: new Map(), answers: new Map(), log: [], qStart: 0, timer: null, saved: false };
  games.set(pin, game);
  return { game };
}

const pubQ = (g, q) => ({ id: q.id, index: g.index, total: g.questions.length, type: q.type, text: q.text,
  timeLimit: q.timeLimit, points: q.points,
  options: q.type === 'MULTIPLE_CHOICE' ? q.options : q.type === 'TRUE_FALSE' ? ['Benar', 'Salah'] : undefined });

const qState = (g, pl) => {
  const q = g.questions[g.index];
  return { ...pubQ(g, q), remainingSec: Math.max(1, Math.ceil((q.timeLimit * 1000 - (Date.now() - g.qStart)) / 1000)), answered: pl ? g.answers.has(pl.id) : false };
};

function distribution(g, q) {
  const as = [...g.answers.values()];
  if (q.type === 'MULTIPLE_CHOICE') return q.options.map((t, i) => ({ label: t, count: as.filter((a) => a.answer === i).length, correct: i === q.correct }));
  if (q.type === 'TRUE_FALSE') return [true, false].map((v) => ({ label: v ? 'Benar' : 'Salah', count: as.filter((a) => a.answer === v).length, correct: q.correct === v }));
  return [{ label: `Benar (${q.answers[0]})`, count: as.filter((a) => a.correct).length, correct: true },
    { label: 'Salah', count: as.filter((a) => !a.correct).length, correct: false }];
}

function persist(g) {
  if (g.saved) return;
  g.saved = true;
  try {
    let sid;
    db.transaction(() => {
      sid = Number(db.prepare('INSERT INTO game_sessions (quiz_id, host_id, pin, quiz_title, questions_json, ended_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
        .run(g.quizId, g.hostId, g.pin, g.title, JSON.stringify(g.questions)).lastInsertRowid);
      const ip = db.prepare('INSERT INTO players (session_id, nickname, score) VALUES (?, ?, ?)');
      const ia = db.prepare('INSERT INTO answers (player_id, q_index, is_correct, response_ms, points, answer) VALUES (?, ?, ?, ?, ?, ?)');
      for (const p of g.players.values()) {
        const pid = ip.run(sid, p.nickname, p.score).lastInsertRowid;
        for (const a of g.log) if (a.pid === p.id) ia.run(pid, a.qi, a.correct ? 1 : 0, a.ms, a.points, JSON.stringify(a.answer));
      }
    })();
    g.reportId = sid;
  } catch (e) { console.error('[game] gagal menyimpan hasil', e); }
}

export function setupRealtime(io) {
  const room = (g) => io.to('game:' + g.pin);
  const ranked = (g) => [...g.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt).map((p, i) => { p.rank = i + 1; return p; });
  const top = (g, n) => ranked(g).slice(0, n).map((p) => ({ nickname: p.nickname, score: p.score, rank: p.rank }));
  const connected = (g) => [...g.players.values()].filter((p) => p.socketId).length;
  const names = (g) => [...g.players.values()].slice(-40).map((p) => p.nickname);

  function lobby(g) { // di-throttle: maks 2x per detik
    if (g.lobbyTimer) return;
    g.lobbyTimer = setTimeout(() => { g.lobbyTimer = null; room(g).emit('lobby:update', { count: g.players.size, names: names(g) }); }, 500);
  }
  function startQuestion(g) {
    g.index++; g.status = 'QUESTION'; g.answers = new Map(); g.qStart = Date.now();
    const q = g.questions[g.index];
    room(g).emit('question:start', pubQ(g, q));
    g.timer = setTimeout(() => endQuestion(g), q.timeLimit * 1000 + GRACE_MS);
  }
  function endQuestion(g) {
    if (g.status !== 'QUESTION') return;
    clearTimeout(g.timer); g.status = 'RESULT';
    const q = g.questions[g.index];
    for (const p of g.players.values()) if (!g.answers.has(p.id)) p.streak = 0;
    const board = top(g, 5);
    g.lastResult = { distribution: distribution(g, q), explanation: q.explanation, noAnswer: g.players.size - g.answers.size, isLast: g.index + 1 >= g.questions.length };
    g.lastBoard = board;
    room(g).emit('question:result', g.lastResult);
    room(g).emit('leaderboard:update', board);
    for (const p of g.players.values()) {
      const a = g.answers.get(p.id);
      p.lastFeedback = { answered: !!a, correct: !!a?.correct, points: a?.points || 0, score: p.score, streak: p.streak, rank: p.rank };
      if (p.socketId) io.to(p.socketId).emit('player:feedback', p.lastFeedback);
    }
  }
  function podium(g) {
    if (g.status === 'PODIUM') return;
    clearTimeout(g.timer); g.status = 'PODIUM';
    persist(g);
    g.podiumData = { top: top(g, 5), total: g.players.size, reportId: g.reportId };
    room(g).emit('game:podium', g.podiumData);
    for (const p of g.players.values()) if (p.socketId) io.to(p.socketId).emit('player:final', { rank: p.rank, score: p.score, total: g.players.size });
    setTimeout(() => games.delete(g.pin), 2 * 3600 * 1000).unref();
  }

  io.on('connection', (socket) => {
    const err = (code, message) => socket.emit('app:error', { code, message });
    const host = (fn) => (raw) => {
      const g = games.get(socket.data.pin);
      if (socket.data.role !== 'host' || !g || g.hostId !== socket.data.userId) return err('FORBIDDEN', 'Hanya host yang boleh melakukan ini.');
      fn(g, raw);
    };

    socket.on('host:join', (raw) => {
      const p = hostJoinSchema.safeParse(raw);
      const user = userFromCookieHeader(socket.request.headers.cookie);
      const g = p.success && games.get(p.data.pin);
      if (!g || !user || g.hostId !== user.id) return err('INVALID_PIN', 'Game tidak ditemukan atau bukan milikmu.');
      Object.assign(socket.data, { role: 'host', pin: g.pin, userId: user.id });
      socket.join('game:' + g.pin);
      socket.emit('host:joined', { title: g.title, status: g.status, count: g.players.size, names: names(g), total: g.questions.length });
      if (g.status === 'QUESTION') { socket.emit('question:start', qState(g)); socket.emit('question:progress', { answered: g.answers.size, total: connected(g) }); }
      else if (g.status === 'RESULT') { socket.emit('question:result', g.lastResult); socket.emit('leaderboard:update', g.lastBoard); }
      else if (g.status === 'PODIUM') socket.emit('game:podium', g.podiumData);
      else if (g.status === 'COUNTDOWN') socket.emit('game:countdown', { seconds: 3 });
    });

    socket.on('player:join', (raw) => {
      socket.data.tries = (socket.data.tries || 0) + 1;
      if (socket.data.tries > 15) return err('RATE_LIMITED', 'Terlalu banyak percobaan. Muat ulang halaman.');
      const p = joinSchema.safeParse(raw);
      if (!p.success) return err('VALIDATION_ERROR', p.error.issues[0].message);
      const g = games.get(p.data.pin);
      if (!g) return err('INVALID_PIN', 'PIN tidak ditemukan. Cek lagi angka di layar guru.');
      if (g.status !== 'WAITING') return err('GAME_STARTED', 'Game sudah dimulai.');
      if (g.players.size >= MAX_PLAYERS) return err('GAME_FULL', 'Game sudah penuh.');
      const nick = p.data.nickname.replace(/\s+/g, ' ');
      if ([...g.players.values()].some((x) => x.nickname.toLowerCase() === nick.toLowerCase())) return err('NICKNAME_TAKEN', 'Nama itu sudah dipakai. Pilih nama lain.');
      const player = { id: randomBytes(8).toString('hex'), token: randomBytes(16).toString('hex'), nickname: nick,
        socketId: socket.id, score: 0, streak: 0, rank: 0, joinedAt: Date.now() };
      g.players.set(player.id, player);
      Object.assign(socket.data, { role: 'player', pin: g.pin, playerId: player.id });
      socket.join('game:' + g.pin);
      socket.emit('player:joined', { pin: g.pin, playerId: player.id, token: player.token, nickname: nick, title: g.title });
      lobby(g);
    });

    socket.on('player:answer', (raw) => {
      const g = games.get(socket.data.pin), pl = g && g.players.get(socket.data.playerId);
      if (socket.data.role !== 'player' || !pl) return err('FORBIDDEN', 'Kamu belum bergabung.');
      const p = answerSchema.safeParse(raw);
      if (!p.success) return err('VALIDATION_ERROR', 'Jawaban tidak valid.');
      const q = g.questions[g.index];
      if (g.status !== 'QUESTION' || !q || q.id !== p.data.questionId) return err('NOT_ACTIVE', 'Soal ini sudah berakhir.');
      if (g.answers.has(pl.id)) return err('ALREADY_ANSWERED', 'Kamu sudah menjawab soal ini.');
      const ms = Date.now() - g.qStart; // waktu dihitung server, bukan klien
      if (isLate(ms, q.timeLimit * 1000)) return err('TOO_LATE', 'Waktu habis.');
      const correct = checkAnswer(q, p.data.answer);
      const r = scoreAnswer({ correct, responseMs: ms, timeLimitMs: q.timeLimit * 1000, basePoints: q.points, streakBefore: pl.streak });
      pl.score += r.points; pl.streak = r.streak;
      g.answers.set(pl.id, { answer: p.data.answer, correct, ms, points: r.points });
      g.log.push({ pid: pl.id, qi: g.index, correct, ms, points: r.points, answer: p.data.answer });
      socket.emit('answer:received', {});
      for (const s of io.sockets.adapter.rooms.get('game:' + g.pin) || []) {
        const x = io.sockets.sockets.get(s);
        if (x && x.data.role === 'host') x.emit('question:progress', { answered: g.answers.size, total: connected(g) });
      }
      if (g.answers.size >= connected(g)) endQuestion(g);
    });

    socket.on('host:start', host((g) => {
      if (g.status !== 'WAITING') return err('BAD_STATE', 'Game sudah dimulai.');
      if (!g.players.size) return err('NO_PLAYERS', 'Belum ada pemain yang bergabung.');
      g.status = 'COUNTDOWN';
      room(g).emit('game:countdown', { seconds: 3 });
      setTimeout(() => { if (g.status === 'COUNTDOWN') startQuestion(g); }, 3000);
    }));
    socket.on('host:skip', host((g) => endQuestion(g)));
    socket.on('host:next', host((g) => {
      if (g.status !== 'RESULT') return err('BAD_STATE', 'Belum waktunya lanjut.');
      if (g.index + 1 >= g.questions.length) podium(g); else startQuestion(g);
    }));
    socket.on('host:end', host((g) => podium(g)));

    socket.on('player:reconnect', (raw) => {
      socket.data.tries = (socket.data.tries || 0) + 1;
      if (socket.data.tries > 15) return err('RATE_LIMITED', 'Terlalu banyak percobaan. Muat ulang halaman.');
      const p = reconnectSchema.safeParse(raw);
      if (!p.success) return err('RECONNECT_FAILED', 'Data sesi tidak valid.');
      const g = games.get(p.data.pin), pl = g && g.players.get(p.data.playerId);
      const a = pl && Buffer.from(pl.token), b = Buffer.from(p.data.token);
      if (!pl || a.length !== b.length || !timingSafeEqual(a, b)) return err('RECONNECT_FAILED', 'Sesi lama tidak ditemukan.');
      if (!pl.socketId && Date.now() - pl.dcAt > RECONNECT_MS) return err('RECONNECT_EXPIRED', 'Waktu sambung ulang (30 detik) sudah habis. Gabung lagi dengan PIN.');
      const old = pl.socketId && io.sockets.sockets.get(pl.socketId);
      pl.socketId = socket.id; pl.dcAt = null;
      if (old) old.disconnect(true);
      Object.assign(socket.data, { role: 'player', pin: g.pin, playerId: pl.id });
      socket.join('game:' + g.pin);
      socket.emit('player:joined', { pin: g.pin, playerId: pl.id, token: pl.token, nickname: pl.nickname, title: g.title });
      if (g.status === 'QUESTION') socket.emit('question:start', qState(g, pl));
      else if (g.status === 'RESULT' && pl.lastFeedback) socket.emit('player:feedback', pl.lastFeedback);
      else if (g.status === 'PODIUM') { ranked(g); socket.emit('player:final', { rank: pl.rank, score: pl.score, total: g.players.size }); }
      else if (g.status === 'COUNTDOWN') socket.emit('game:countdown', { seconds: 3 });
    });

    socket.on('disconnect', () => {
      const g = games.get(socket.data.pin);
      const p = g && socket.data.role === 'player' && g.players.get(socket.data.playerId);
      if (!p || p.socketId !== socket.id) return; // sudah diambil alih koneksi baru
      p.socketId = null; p.dcAt = Date.now();
      if (g.status === 'WAITING') setTimeout(() => { if (!p.socketId && g.status === 'WAITING') { g.players.delete(p.id); lobby(g); } }, RECONNECT_MS);
      else if (g.status === 'QUESTION' && connected(g) > 0 && g.answers.size >= connected(g)) endQuestion(g);
    });
  });
}
