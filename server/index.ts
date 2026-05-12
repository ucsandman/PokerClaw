// Load .env from the project root before any module-level process.env reads.
// dotenv does NOT override variables already set in the real environment,
// so production deployments / CI can still inject overrides normally.
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from './state';
import { buildRouter } from './routes';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const PORT = Number(process.env.PORT ?? 3001);
const STARTING_STACK = Number(process.env.POKERCLAW_STARTING_STACK ?? 10000);

// Blinds come from the tournament schedule in shared/blinds.ts. The legacy
// POKERCLAW_SMALL_BLIND / POKERCLAW_BIG_BLIND vars are no longer used.
const session = new Session({ startingStack: STARTING_STACK });

const app = express();
app.use(express.json());
app.use(buildRouter(session));

// In production builds, serve the Vite-built UI from /dist.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(404).send('UI not built. Run `npm run build`.');
  });
});

app.listen(PORT, '127.0.0.1', () => {
  // Bind to loopback only — this app is local-only by design.
  console.log(`PokerClaw dealer listening on http://localhost:${PORT}`);
});
