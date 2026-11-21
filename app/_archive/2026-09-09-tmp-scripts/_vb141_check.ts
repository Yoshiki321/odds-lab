import * as fs from 'fs';
const dir = 'C:/zwkj/竞彩助手/data/virtual/';
const f = dir + 'vb-141.json';
if (fs.existsSync(f)) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(JSON.stringify({ id: j.id, match: j.home + ' vs ' + j.away, myView: j.myView, direction: j.direction ?? j.selection ?? j.line, odds: j.odds, stake: j.stake, status: j.status }, null, 1));
} else {
  // fallback: grep PG
  console.log('no file');
}
