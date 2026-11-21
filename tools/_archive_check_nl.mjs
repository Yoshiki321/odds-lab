import fs from 'fs';
const s = fs.readFileSync('./data/diary/journals/2026-09-02.json', 'utf8');
// 找出 text 字符串值内部的真实换行
let i = s.indexOf('"text": "');
let lastIdx = 0;
while (i >= 0) {
  let k = i + '"text": "'.length;
  while (k < s.length) {
    if (s[k] === '\\') { k += 2; continue; }
    if (s[k] === '"') break;
    if (s[k] === '\n') {
      console.log('REAL NL at char', k, 'text starts', i, '| around:',
        JSON.stringify(s.slice(k - 40, k + 60)).slice(0, 200));
      break;
    }
    k++;
  }
  lastIdx = k;
  i = s.indexOf('"text": "', k);
}
console.log('scan done');
