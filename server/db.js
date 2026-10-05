import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH || 'data/qwizen.db';
fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quizzes_owner ON quizzes(owner_id);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  time_limit INTEGER NOT NULL DEFAULT 20,
  points INTEGER NOT NULL DEFAULT 1000,
  position INTEGER NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id, position);
`);

// Hasil game disimpan saat game selesai. State live ada di memori (server/game/engine.js).
db.exec(`
CREATE TABLE IF NOT EXISTS game_sessions (
  id INTEGER PRIMARY KEY,
  quiz_id INTEGER,
  host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pin TEXT NOT NULL,
  quiz_title TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_host ON game_sessions(host_id);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_id);
CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  q_index INTEGER NOT NULL,
  is_correct INTEGER NOT NULL,
  response_ms INTEGER NOT NULL,
  points INTEGER NOT NULL,
  answer TEXT,
  UNIQUE (player_id, q_index)
);
`);
