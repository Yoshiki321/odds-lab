import { query } from '../src/server/db/pool.js';
async function main() {
  const t = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'scores' ORDER BY ordinal_position");
  console.log('scores columns:', t.rows.map(r => `${r.column_name}:${r.data_type}`).join(', '));
  const m = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'matches'");
  console.log('matches columns:', m.rows.map(r => r.column_name).join(', '));
  process.exit(0);
}
main();
