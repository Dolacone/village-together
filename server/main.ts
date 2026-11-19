import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startServer } from './app.ts';
import { googleVerifier } from './auth.ts';

const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
const dbPath = resolve(process.env.DB_PATH ?? 'data/world.db');
const seed = process.env.WORLD_SEED ? Number(process.env.WORLD_SEED) : undefined;

if (!clientId) console.warn('GOOGLE_CLIENT_ID is empty: players cannot log in until it is set.');

mkdirSync(dirname(dbPath), { recursive: true });

const server = await startServer({
  port: Number(process.env.PORT ?? 8080),
  dbPath,
  clientId,
  verifier: googleVerifier(clientId),
  staticDir: resolve(import.meta.dirname, '../dist/client'),
  seed,
});

console.log(`village-together listening on :${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
