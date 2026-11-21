import { query } from '../../src/server/db/pool.js';
async function main(){
  const d=await query(`SELECT now(), to_timestamp(extract(epoch from now())/1000 - 36*3600), kickoff, match_id, num FROM matches WHERE num='周二008'`);
  console.log('PG now:', d.rows[0].now, '窗口下界:', d.rows[0].to_timestamp);
  console.log('皇马 kickoff:', new Date(d.rows[0].kickoff).getTime(), new Date(d.rows[0].kickoff).toISOString());
  const w=await query(`SELECT match_id,num FROM matches WHERE kickoff BETWEEN now() - interval '36 hours' AND now() + interval '60 hours' AND num='周二008'`);
  console.log('在窗内?', w.rows);
  await (await import('../../src/server/db/pool.js')).pool().end();
}
main();
