import * as fs from 'fs';
const j = JSON.parse(fs.readFileSync('C:/zwkj/竞彩助手/data/virtual/vb-141.json', 'utf8'));
console.log(JSON.stringify({ pick: j.pick, myView: j.myView }, null, 1));
