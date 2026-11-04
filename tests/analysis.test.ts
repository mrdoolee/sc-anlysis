import { describe, expect, it } from 'vitest';
import { readXlsx } from '../src/core/xlsx.ts';
import { parseGrid } from '../src/core/parse.ts';
import { buildDataset, suggestAliases } from '../src/core/dataset.ts';
import { AVG, alerts, buildMatrix, presetTimepoints, semesterGap, studentTrend, trendCounts } from '../src/core/analysis.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';
import type { ParsedFile } from '../src/core/types.ts';
// @ts-expect-error 타입 없는 .mjs 픽스처
import { makeExamGrid, makeFakeClass, makeLargeClass, writeXlsx } from './fixtures/fake-data.mjs';

const S = structuredClone(DEFAULT_SETTINGS);
const load = (files: { name: string; grid: unknown[][] }[]): ParsedFile[] => files.map((f) => parseGrid(readXlsx(writeXlsx(f.grid)), f.name));

function exam(round: number, subjects: string[], rows: [string, number, (number | null)[]][], semester = 1) {
  return {
    name: `e${round}.xlsx`,
    grid: makeExamGrid({ round, semester, subjects, gradeMeans: subjects.map(() => 50), students: rows.map(([name, no, scores]) => ({ no, sid: no, name, scores })) }),
  };
}

describe('데이터셋', () => {
  const files = load(makeFakeClass({ seed: 5, nStudents: 10 }));
  const ds = buildDataset(files, { aliases: {}, merges: {} });

  it('시점을 학년·학기·유형·회차 순으로 정렬한다', () => {
    expect(ds.timepoints.map((t) => t.label)).toEqual(['1학년 1학기 성적', '2학년 1학기 1회고사', '2학년 1학기 2회고사', '2학년 1학기 성적', '2학년 2학기 3회고사']);
  });

  it('이름으로 파일 간 학생을 매칭한다', () => {
    expect(ds.students.length).toBe(10);
    expect(ds.students[0]).toMatchObject({ name: '학생01', nos: [1] });
    expect(ds.students[0].sid).not.toBeNull();
  });

  it('사회 → 역사 별칭을 제안한다', () => {
    expect(suggestAliases(ds)).toContainEqual(expect.objectContaining({ from: '사회', to: '역사' }));
  });

  it('별칭을 적용하면 과목명이 바뀐다', () => {
    const d2 = buildDataset(files, { aliases: { 사회: '역사' }, merges: {} });
    expect(d2.timepoints[0].subjects).toContain('역사');
    expect(d2.timepoints[0].subjects).not.toContain('사회');
  });

  it('한 파일 안 동명이인은 이름#번호로 구분한다', () => {
    const d = buildDataset(load([exam(1, ['국어'], [['학생01', 1, [10]], ['학생01', 2, [20]], ['학생03', 3, [30]]])]), { aliases: {}, merges: {} });
    expect(d.students.map((s) => s.key)).toEqual(['학생01#1', '학생01#2', '학생03']);
  });

  it('번호가 다르면 경고하고, 병합 지정 시 한 학생으로 합친다', () => {
    const f = load([exam(1, ['국어'], [['가', 1, [10]], ['나', 2, [20]]]), exam(2, ['국어'], [['가', 5, [30]], ['나나', 2, [40]]])]);
    const d = buildDataset(f, { aliases: {}, merges: {} });
    expect(d.issues.some((i) => i.message.startsWith('가: 파일마다 번호가 다릅니다'))).toBe(true);
    expect(d.students.length).toBe(3);
    const m = buildDataset(f, { aliases: {}, merges: { 나나: '나' } });
    expect(m.students.length).toBe(2);
  });

  it('사용자 순서와 시점 정보 수정을 반영한다', () => {
    const ids = ds.timepoints.map((t) => t.id);
    const d = buildDataset(files, { aliases: {}, merges: {}, tpOrder: [...ids].reverse(), tpOverrides: { [ids[0]]: { label: '작년' } } });
    expect(d.timepoints[0].id).toBe(ids.at(-1));
    expect(d.timepoints.at(-1)!.label).toBe('작년');
  });
});

describe('시나리오 프리셋', () => {
  const ds = buildDataset(load(makeFakeClass({ seed: 5, nStudents: 10 })), { aliases: {}, merges: {} });
  const labels = (ids: string[]) => ids.map((id) => ds.timepoints.find((t) => t.id === id)!.label);

  it('S1: 직전 학년 학기 성적 + 현재 학년 첫 고사', () => {
    expect(labels(presetTimepoints(ds, 'S1'))).toEqual(['1학년 1학기 성적', '2학년 1학기 1회고사']);
  });
  it('S2: 학년 내 고사', () => {
    expect(labels(presetTimepoints(ds, 'S2'))).toEqual(['2학년 1학기 1회고사', '2학년 1학기 2회고사', '2학년 2학기 3회고사']);
  });
  it('S3: 전체', () => {
    expect(presetTimepoints(ds, 'S3').length).toBe(5);
  });
  it('S4: 두 시점', () => {
    const a = ds.timepoints[0].id;
    const b = ds.timepoints[2].id;
    expect(presetTimepoints(ds, 'S4', { a, b })).toEqual([a, b]);
  });
  it('3학년도 같은 규칙으로 동작한다(학년 비고정)', () => {
    const d3 = buildDataset(load(makeFakeClass({ seed: 9, nStudents: 6, grade: 3 })), { aliases: {}, merges: {} });
    expect(presetTimepoints(d3, 'S1').map((id) => d3.timepoints.find((t) => t.id === id)!.label)).toEqual(['2학년 1학기 성적', '3학년 1학기 1회고사']);
  });
});

describe('행렬과 지표', () => {
  const rows: [string, number, (number | null)[]][] = [
    ['가', 1, [90, 60]], ['나', 2, [80, 70]], ['다', 3, [70, 80]], ['라', 4, [60, 90]], ['마', 5, [50, null]],
  ];
  const ds = buildDataset(load([exam(1, ['국어', '수학'], rows), exam(2, ['국어', '영어'], rows.map(([n, no, s]) => [n, no, [s[0] === null ? null : 100 - s[0], 50]]))]), { aliases: {}, merges: {} });
  const ids = ds.timepoints.map((t) => t.id);
  const m = buildMatrix(ds, ids, 'subject', S);

  it('학급 z의 합은 0, T는 50+10z', () => {
    const zs = ds.students.map((s) => m.cell('국어', ids[0], s.key)!.z!);
    expect(zs.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
    const c = m.cell('국어', ids[0], '가')!;
    expect(c.z).toBeCloseTo((90 - 70) / Math.sqrt(200), 10);
    expect(c.t).toBeCloseTo(50 + 10 * c.z!, 10);
  });

  it('n < 5 또는 σ = 0이면 z를 계산하지 않고 사유를 남긴다', () => {
    expect(m.stat('수학', ids[0])!.n).toBe(4);
    expect(m.stat('수학', ids[0])!.zReason).toMatch(/인원 부족/);
    expect(m.cell('수학', ids[0], '가')!.z).toBeNull();
    expect(m.stat('영어', ids[1])!.zReason).toBe('표준편차 0');
  });

  it('공통 과목 평균은 모든 시점에 있는 과목만 쓴다', () => {
    expect(m.common).toEqual(['국어']);
    expect(m.cell(AVG, ids[0], '가')!.raw).toBe(90);
    expect(m.cell(AVG, ids[1], '가')!.raw).toBe(10);
  });

  it('석차·백분위·학년평균 편차·성취도', () => {
    const c = m.cell('국어', ids[0], '나')!;
    expect(c.rank).toBe(2);
    expect(c.pr).toBe(70);
    expect(c.dev).toBe(30);
    expect(c.achCalc).toBe('B');
  });

  it('학년 σ를 입력한 경우에만 z(학년)을 계산한다', () => {
    expect(m.cell('국어', ids[0], '가')!.zg).toBeNull();
    const m2 = buildMatrix(ds, ids, 'subject', S, { [`${ids[0]}|국어`]: 10 });
    expect(m2.cell('국어', ids[0], '가')!.zg).toBe(4);
  });

  it('추세: Δ, Δz, 라벨', () => {
    const t = studentTrend(m, '국어', '가', 'raw', S);
    expect(t.delta).toBe(-80);
    expect(t.label).toBe('하락');
    expect(t.slope).toBeNull();
    expect(studentTrend(m, '국어', '마', 'raw', S).label).toBe('상승');
    const counts = trendCounts(m, '국어', S);
    expect(counts.상승 + counts.하락 + counts.유지 + counts['판단 불가']).toBe(5);
  });

  it('교과군 단위: 묶음 내 과목 평균', () => {
    const settings = { ...S, groups: [{ name: '주요', subjects: ['국어', '수학'] }] };
    const g = buildMatrix(ds, ids, 'group', settings);
    expect(g.items.map((i) => i.id)).toEqual(['g:주요', '영어', AVG]);
    expect(g.cell('g:주요', ids[0], '가')!.raw).toBe(75);
    expect(g.cell('g:주요', ids[0], '마')).toBeUndefined();
    expect(g.stat('g:주요', ids[1])!.members).toEqual(['국어']);
  });

  it('주의 학생: 최근 Δz ≤ −1.0', () => {
    const a = alerts(m, S, (id) => id);
    expect(a.map((x) => x.student)).toContain('가');
  });
});

describe('학기종합 ↔ 고사 격차', () => {
  it('같은 학년·학기 고사 평균과 비교한다', () => {
    const ds = buildDataset(load(makeFakeClass({ seed: 2, nStudents: 8 })), { aliases: {}, merges: {} });
    const gaps = semesterGap(ds);
    expect(gaps.length).toBe(1);
    expect(gaps[0].semTp.label).toBe('2학년 1학기 성적');
    expect(gaps[0].examTps.length).toBe(2);
    const row = gaps[0].rows.find((r) => r.subject === '국어')!;
    expect(row.n).toBe(8);
    const one = row.perStudent.get('학생01')!;
    expect(one.gap).toBeCloseTo(one.sem - one.exam, 10);
  });
});

describe('성능', () => {
  it('40명 × 20시점 × 10과목 행렬 계산 < 200ms', () => {
    const ds = buildDataset(load(makeLargeClass({})), { aliases: {}, merges: {} });
    expect(ds.timepoints.length).toBe(20);
    const t0 = performance.now();
    const m = buildMatrix(ds, ds.timepoints.map((t) => t.id), 'subject', S);
    for (const s of m.students) studentTrend(m, AVG, s, 'z', S);
    alerts(m, S, (x) => x);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('학부모용 해석', async () => {
  const { interpretParent } = await import('../src/core/interpret.ts');
  const rows: [string, number, (number | null)[]][] = [
    ['가', 1, [60, 70]], ['나', 2, [80, 70]], ['다', 3, [70, 80]], ['라', 4, [60, 90]], ['마', 5, [50, 40]],
  ];
  const ds = buildDataset(load([exam(1, ['국어', '수학'], rows), exam(2, ['국어', '수학'], rows.map(([n, no, s]) => [n, no, [s[0]! + 10, s[1]! - 5]]))]), { aliases: {}, merges: {} });
  const ids = ds.timepoints.map((t) => t.id);
  const m = buildMatrix(ds, ids, 'subject', S);
  const lines = interpretParent(m, '가', (id) => (id === ids[0] ? '1회' : '2회'));

  it('z·석차 용어 없이 원점수와 학년 평균으로 설명한다', () => {
    expect(lines[0]).toBe('공통 과목 평균 점수가 1회 65.0점에서 2회 67.5점으로 2.5점 올랐습니다.');
    expect(lines.join(' ')).not.toMatch(/z|석차|백분위/);
    expect(lines.length).toBeLessThanOrEqual(5);
  });
  it('학년 평균 비교·강점·관심 과목', () => {
    expect(lines).toContain('2회 평균은 학년 평균보다 17.5점 높습니다.');
    expect(lines).toContain('학년 평균보다 높은 과목: 국어(+20.0점), 수학(+15.0점).');
    expect(lines).toContain('가장 많이 오른 과목은 국어(+10.0점)입니다.');
  });
});
