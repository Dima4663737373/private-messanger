import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { initDB } from './database';
import { setupWebSocket } from './websocket';
import routes from './routes';

const app = express();
const server = createServer(app);

// ── Security ──────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error('CORS blocked'));
  },
  methods: ['GET', 'POST', 'DELETE']
}));

app.use(rateLimit({ windowMs: 15 * 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '100kb' }));

// ── Routes ──────────────────────────────────────

app.use('/api', routes);

app.get('/health', (_req, res) => res.json({ status: 'ok', time: Date.now() }));

// ── WebSocket ──────────────────────────────────

setupWebSocket(server);

// ── Start ──────────────────────────────────────

const PORT = Number(process.env.PORT) || 3001;

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`[Ghost] Server running on port ${PORT}`);
    console.log(`[Ghost] WebSocket on ws://localhost:${PORT}`);
  });
});
