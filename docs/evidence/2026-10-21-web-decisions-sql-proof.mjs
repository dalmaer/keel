// Optional isolated SQL tooling, not an application dependency or hosted proof.
// Usage: node <this-file> /absolute/tooling/node_modules/@electric-sql/pglite/dist/index.js
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.argv[2]);
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const file of ['001-auth.sql','002-home-cache.sql','003-home-retry.sql','004-decision-operations.sql'])
    await db.exec(await readFile(new URL(`../../lib/web/migrations/${file}`,import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./2026-10-21-web-decisions-hosted-proof.sql',import.meta.url),'utf8'));
  console.log('PASS: role denial, RLS, immutable scoped previews, replay identity, project reservation, fencing, prepared expiry, persistent dispatched/uncertain reservations, terminal receipts, preview expiry and synthetic rollback. Single connection; no hosted or concurrency claim.');
} catch (error) {
  console.error('FAIL:',error.code,error.message,error.where ?? '');
  process.exitCode=1;
} finally { await db.close(); }
