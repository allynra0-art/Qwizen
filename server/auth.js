import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from './db.js';
import { registerSchema, loginSchema } from './schemas.js';

let secret = process.env.JWT_SECRET;
if (!secret) {
  secret = (await import('node:crypto')).randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET kosong: memakai secret sementara, semua login hilang saat server restart.');
}

export const fail = (res, status, code, message) =>
  res.status(status).json({ success: false, error: { code, message } });
export const invalid = (res, zerr) =>
  fail(res, 400, 'VALIDATION_ERROR', zerr.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));

const COOKIE = 'qwizen_session';
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production' && !!process.env.PUBLIC_URL?.startsWith('https'),
  maxAge: 7 * 24 * 3600 * 1000,
};
const setSession = (res, id) => res.cookie(COOKIE, jwt.sign({ uid: id }, secret, { expiresIn: '7d' }), cookieOpts);

export function requireAuth(req, res, next) {
  try {
    const { uid } = jwt.verify(req.cookies[COOKIE] || '', secret);
    const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(uid);
    if (!user) throw new Error('no user');
    req.user = user;
    next();
  } catch {
    fail(res, 401, 'UNAUTHORIZED', 'Silakan masuk terlebih dahulu.');
  }
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => fail(res, 429, 'RATE_LIMITED', 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'),
});

export const authRouter = Router();

authRouter.post('/register', limiter, (req, res) => {
  const p = registerSchema.safeParse(req.body);
  if (!p.success) return invalid(res, p.error);
  const { name, email, password } = p.data;
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    return fail(res, 409, 'EMAIL_TAKEN', 'Email ini sudah terdaftar.');
  const hash = bcrypt.hashSync(password, 10);
  const id = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(email, name, hash).lastInsertRowid;
  setSession(res, Number(id));
  res.status(201).json({ success: true, data: { id: Number(id), name, email } });
});

authRouter.post('/login', limiter, (req, res) => {
  const p = loginSchema.safeParse(req.body);
  if (!p.success) return invalid(res, p.error);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(p.data.email);
  if (!u || !bcrypt.compareSync(p.data.password, u.password_hash))
    return fail(res, 401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
  setSession(res, u.id);
  res.json({ success: true, data: { id: u.id, name: u.name, email: u.email } });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ success: true, data: null });
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ success: true, data: req.user }));

// Dipakai Socket.IO untuk mengenali host dari cookie sesi.
export function userFromCookieHeader(header = '') {
  const part = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  if (!part) return null;
  try {
    const { uid } = jwt.verify(decodeURIComponent(part.slice(COOKIE.length + 1)), secret);
    return db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(uid) || null;
  } catch { return null; }
}
