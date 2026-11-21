/**
 * rng.ts — 可复现伪随机数（mulberry32，使用 Math.imul 避免大整数精度丢失）
 * 用法: 见下自检；被 match_level_eval 引用
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 检测在前 n 个输出内是否出现 4 元组重复（用于验证短周期） */
export function hasShortPeriod(rnd: () => number, n: number): boolean {
  const seen = new Set<string>();
  const buf: number[] = [];
  for (let i = 0; i < n; i++) {
    buf.push(rnd());
    if (buf.length >= 4) {
      const k = buf.slice(-4).map((x) => Math.floor(x * 1e6)).join(',');
      if (seen.has(k)) return true;
      seen.add(k);
    }
  }
  return false;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('rng.ts')) {
  const assert = (c: boolean, m: string) => { if (!c) throw new Error(m); };
  const a = mulberry32(12345), b = mulberry32(12345);
  const s1 = [a(), a(), a()], s2 = [b(), b(), b()];
  assert(JSON.stringify(s1) === JSON.stringify(s2), '同种子必须同序列');
  assert(!hasShortPeriod(mulberry32(12345), 200000), '前 20 万次不应出现 4 元组重复');
  const c = mulberry32(999), vals = new Set<number>();
  for (let i = 0; i < 200000; i++) vals.add(c());
  assert(vals.size > 199000, `输出多样性异常: ${vals.size}`);
  console.log('rng self-check OK', { first: s1, unique200k: vals.size });
}
