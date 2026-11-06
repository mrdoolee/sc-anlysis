// 통계 기본 함수. 결측(null)은 항상 계산에서 제외한다.

export const present = (xs: (number | null | undefined)[]): number[] => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** 모표준편차(ddof=0) */
export function popSd(xs: number[]): number | null {
  const m = mean(xs);
  if (m === null) return null;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

export const tScore = (z: number): number => 50 + 10 * z;

/** 값마다 '더 작은 값의 수'와 '같은 값의 수'(정렬 한 번, O(n log n)) */
function belowEqual(values: (number | null)[]): { n: number; below: Map<number, number>; equal: Map<number, number> } {
  const xs = present(values).sort((a, b) => a - b);
  const below = new Map<number, number>();
  const equal = new Map<number, number>();
  for (let i = 0; i < xs.length; i++) {
    if (!below.has(xs[i])) below.set(xs[i], i);
    equal.set(xs[i], (equal.get(xs[i]) ?? 0) + 1);
  }
  return { n: xs.length, below, equal };
}

/** 경쟁 순위: 높은 점수가 1위, 동점은 같은 순위, 다음 순위는 건너뛴다. */
export function competitionRanks(values: (number | null)[]): (number | null)[] {
  const { n, below, equal } = belowEqual(values);
  // 나보다 큰 값의 수 = n − (작은 수 + 같은 수)
  return values.map((v) => (v === null ? null : n - (below.get(v)! + equal.get(v)!) + 1));
}

/** 백분위 PR = (낮은 수 + 0.5 × 동점 수(본인 포함)) / n × 100 */
export function percentileRanks(values: (number | null)[]): (number | null)[] {
  const { n, below, equal } = belowEqual(values);
  return values.map((v) => (v === null ? null : ((below.get(v)! + 0.5 * equal.get(v)!) / n) * 100));
}

/** 시점 순번(0,1,2…)에 대한 최소제곱 기울기. 값이 3개 미만이면 null. */
export function slope(ys: (number | null)[]): number | null {
  const pts = ys.map((y, x) => [x, y] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 3) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  return pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx;
}

/** 선형 보간 사분위수(Excel QUARTILE.INC와 같음) */
export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 만점 대비 백분율로 성취도 환산. cutoffs = [A, B, C, D] 하한 */
export function achievementOf(score: number | null, max: number, cutoffs: readonly number[]): string | null {
  if (score === null) return null;
  const p = (score / max) * 100;
  const letters = ['A', 'B', 'C', 'D'];
  for (let i = 0; i < letters.length; i++) if (p >= cutoffs[i] - 1e-9) return letters[i];
  return 'E';
}

export const fmt = (x: number | null | undefined, digits = 1): string => (x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(digits));
export const fmtSigned = (x: number | null | undefined, digits = 1): string =>
  x === null || x === undefined || !Number.isFinite(x) ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(digits)}`;
