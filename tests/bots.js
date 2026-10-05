// Pemakaian: npm run bots -- <PIN> [jumlah=30] [url=http://localhost:3000]
import { io } from 'socket.io-client';
const [pin, n = '30', url = 'http://localhost:3000'] = process.argv.slice(2);
if (!/^\d{6}$/.test(pin || '')) { console.log('Pemakaian: npm run bots -- 123456 50'); process.exit(1); }
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a));
const stat = { joined: 0, answered: 0, errors: {} };
for (let i = 0; i < Number(n); i++) {
  setTimeout(() => {
    const s = io(url);
    s.on('connect', () => s.emit('player:join', { pin, nickname: 'Bot' + (i + 1) }));
    s.on('player:joined', () => stat.joined++);
    s.on('app:error', (e) => { stat.errors[e.code] = (stat.errors[e.code] || 0) + 1; });
    s.on('question:start', (q) => setTimeout(() => {
      const answer = q.type === 'MULTIPLE_CHOICE' ? rnd(0, q.options.length) : q.type === 'TRUE_FALSE' ? Math.random() < 0.5 : 'tes';
      s.emit('player:answer', { questionId: q.id, answer }); stat.answered++;
    }, rnd(300, Math.max(600, q.timeLimit * 600))));
  }, i * 40);
}
setInterval(() => console.log(`bot masuk: ${stat.joined}/${n} | jawaban terkirim: ${stat.answered} | error:`, JSON.stringify(stat.errors)), 3000);
