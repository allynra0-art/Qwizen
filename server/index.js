import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { authRouter, fail } from './auth.js';
import { quizzesRouter } from './routes/quizzes.js';
import { gamesRouter } from './routes/games.js';
import { reportsRouter } from './routes/reports.js';
import { setupRealtime } from './game/engine.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const root = path.dirname(fileURLToPath(import.meta.url));

const lanIps = () => Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
const baseUrl = () => process.env.PUBLIC_URL || `http://${lanIps()[0] || 'localhost'}:${PORT}`;

app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ success: true, data: { ok: true } }));
app.get('/api/info', (_req, res) => res.json({ success: true, data: { joinUrl: baseUrl() } }));
app.get('/api/qr/:pin.svg', async (req, res) => {
  if (!/^\d{6}$/.test(req.params.pin)) return fail(res, 400, 'INVALID_PIN', 'PIN tidak valid.');
  const svg = await QRCode.toString(`${baseUrl()}/play.html?pin=${req.params.pin}`, { type: 'svg', margin: 1, color: { dark: '#2D2A3E', light: '#FFFFFF' } });
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
});
app.use('/api/auth', authRouter);
app.use('/api/quizzes', quizzesRouter);
app.use('/api/games', gamesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api', (_req, res) => fail(res, 404, 'NOT_FOUND', 'Endpoint tidak ditemukan.'));
app.use(express.static(path.join(root, '..', 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'BAD_JSON', 'Format data tidak valid.');
  console.error(err);
  fail(res, 500, 'INTERNAL_ERROR', 'Terjadi kesalahan di server.');
});

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10_000 });
setupRealtime(io);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Qwizen berjalan di http://localhost:${PORT}`);
  for (const ip of lanIps()) console.log(`Mode LAN (HP siswa buka): http://${ip}:${PORT}`);
});
