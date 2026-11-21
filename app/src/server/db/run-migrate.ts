import { migrate } from './pool.js';

try {
  await migrate();
  console.log('[migrate] schema applied OK');
  process.exit(0);
} catch (e: any) {
  console.error('[migrate] FAILED:', e?.message ?? e);
  process.exit(1);
}
