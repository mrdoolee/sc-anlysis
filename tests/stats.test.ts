import { describe, expect, it } from 'vitest';
import { achievementOf, competitionRanks, fmtSigned, mean, percentileRanks, popSd, quantile, slope, tScore } from '../src/core/stats.ts';

describe('stats', () => {
  it('평균·모표준편차(ddof=0)', () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    expect(popSd([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(mean([])).toBeNull();
  });

  it('T = 50 + 10z', () => {
    expect(tScore(1.5)).toBe(65);
    expect(tScore(-2)).toBe(30);
  });

  it('경쟁 순위: 동점 동순위, 다음 순위 건너뜀, 결측 제외', () => {
    expect(competitionRanks([90, 80, 90, null, 70])).toEqual([1, 3, 1, null, 4]);
  });

  it('백분위 PR = (낮은 수 + 0.5×동점 수)/n×100', () => {
    expect(percentileRanks([10, 20, 20, 30])).toEqual([12.5, 50, 50, 87.5]);
  });

  it('기울기는 결측을 건너뛰고 시점 순번 기준, 3점 미만이면 null', () => {
    expect(slope([1, 2, 3])).toBeCloseTo(1);
    // x = 0, 2, 3 → 기울기 2
    expect(slope([10, null, 14, 16])).toBeCloseTo(2, 10);
    expect(slope([1, 2])).toBeNull();
  });

  it('사분위수(선형 보간)', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
  });

  it('성취도 환산 기본 기준 A≥90 B≥80 C≥70 D≥60 E<60', () => {
    const c = [90, 80, 70, 60];
    expect([96, 90, 89.9, 81, 70, 69, 60, 59.9, 34].map((s) => achievementOf(s, 100, c))).toEqual(['A', 'A', 'B', 'B', 'C', 'D', 'D', 'E', 'E']);
    expect(achievementOf(45, 50, c)).toBe('A');
    expect(achievementOf(null, 100, c)).toBeNull();
  });

  it('부호 표시', () => {
    expect(fmtSigned(1.23)).toBe('+1.2');
    expect(fmtSigned(-0.5)).toBe('−0.5');
    expect(fmtSigned(null)).toBe('–');
  });
});
