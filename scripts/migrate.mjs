// Runner de migraciones. Usa el rol DUEÑO (DATABASE_URL_OWNER), nunca el rol de runtime.
// Uso: npm run db:migrate | npm run db:rollback   (o: ... -- up|down [n])
import { runner } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const direction = process.argv[2] === 'down' ? 'down' : 'up';
const countArg = process.argv[3];
const databaseUrl = process.env.DATABASE_URL_OWNER;
if (!databaseUrl) {
  console.error('Falta DATABASE_URL_OWNER (ver .env.example)');
  process.exit(1);
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/db/migrations');
const applied = await runner({
  databaseUrl,
  dir,
  direction,
  count: direction === 'down' ? Number(countArg ?? 1) : Infinity,
  migrationsTable: 'pgmigrations',
  log: (m) => console.log(m),
});
console.log(`${direction}: ${applied.length} migración(es)`);
