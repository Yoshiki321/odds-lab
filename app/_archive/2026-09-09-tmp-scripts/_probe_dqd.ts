// 探测懂球帝 match detail 是否含首发/伤停字段
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
async function probe(){
  // 2041347 = vb-140 布鲁日 场次（已踢）；找一个今晚 00:45 的 2041360 特温特
  for (const id of ['2041360','2041362']) {
    const url=`https://www.dongqiudi.com/magicball/v1/match/app/detail?id=${id}&app=dqd&lang=zh-cn`;
    const r=await fetch(url,{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
    const j=await r.json();
    const d=j?.data?.match ?? j?.data ?? j;
    const keys=Object.keys(d||{});
    const interesting=keys.filter(k=>/line|lineup|starting|injur|absenc|player|formation|squad/i.test(k));
    console.log(id, 'keys:', interesting.join(',') || '(none of lineup/injury)');
    console.log('  matchSample?', !!d?.matchSample, ' sample keys:', Object.keys(d?.matchSample||{}).slice(0,12).join(','));
  }
}
probe().catch(e=>console.error('ERR',e?.message));
