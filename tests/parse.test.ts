import { describe, expect, it } from 'vitest';
import { readXlsx } from '../src/core/xlsx.ts';
import { parseExamMeta, parseGrid } from '../src/core/parse.ts';
// @ts-expect-error 타입 없는 .mjs 픽스처
import { makeExamGrid, makeFakeClass, makeSemesterGrid, writeXlsx } from './fixtures/fake-data.mjs';

const roundTrip = (grid: unknown[][]) => readXlsx(writeXlsx(grid));

describe('readXlsx', () => {
  it('공유 문자열·숫자·빈 셀을 읽는다', () => {
    const g = roundTrip([['가 & <나>', 1.5, null], [null, '', 3]]);
    expect(g[0][0]).toBe('가 & <나>');
    expect(g[0][1]).toBe(1.5);
    expect(g[0][2]).toBeNull();
    expect(g[1][2]).toBe(3);
  });

  it('xlsx가 아니면 한국어 오류를 낸다', () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow(/xlsx 형식이 아닙니다/);
  });
});

describe('parseExamMeta', () => {
  it('학년도·학기·학년·반·회차를 추출한다', () => {
    expect(parseExamMeta('2026학년도  2학기  주간  3학년  12반 고사 :   3회고사')).toEqual({ year: 2026, semester: 2, grade: 3, cls: 12, round: 3 });
  });
});

describe('고사 파일', () => {
  const students = [
    { no: 1, sid: 2025000001, name: '학생01', scores: [80, 90, 70, 60, 50] },
    { no: 2, sid: 2025000002, name: '학생02', scores: [null, 40, 50, 60, 70] },
    { no: 3, sid: 2025000003, name: '학생03', scores: [100, 100, 100, 100, 100] },
  ];
  const grid = makeExamGrid({ subjects: ['국어', '역사', '수학', '과학', '영어'], students, gradeMeans: [61, 62, 63, 64, 65], round: 2, semester: 1, grade: 2 });
  const pf = parseGrid(roundTrip(grid), '2-2.xlsx');

  it('메타와 과목을 읽는다', () => {
    expect(pf.kind).toBe('exam');
    const tp = pf.timepoints[0];
    expect(tp).toMatchObject({ year: 2026, semester: 1, grade: 2, round: 2, classLabel: '2학년 7반' });
    expect(tp.subjects).toEqual(['국어', '역사', '수학', '과학', '영어']);
  });

  it('요약 행을 학생으로 취급하지 않는다', () => {
    const names = new Set(pf.timepoints[0].records.map((r) => r.name));
    expect([...names]).toEqual(['학생01', '학생02', '학생03']);
  });

  it('빈 점수는 0점이 아니라 결측이다', () => {
    const r = pf.timepoints[0].records.find((x) => x.name === '학생02' && x.subject === '국어')!;
    expect(r.score).toBeNull();
    expect(pf.integrity.some((i) => i.message.includes('번호 2: 빈 점수 1과목'))).toBe(true);
  });

  it('학번·만점·학년평균·응시자수를 읽는다', () => {
    const r = pf.timepoints[0].records.find((x) => x.name === '학생01' && x.subject === '수학')!;
    expect(r).toMatchObject({ sid: '2025000001', max: 100, gradeMean: 63, gradeN: 196, score: 70 });
  });

  it('파일 합계·평균과 재계산 값이 맞으면 불일치 경고가 없다', () => {
    expect(pf.integrity.filter((i) => i.message.includes('불일치'))).toEqual([]);
  });

  it('합계가 틀리면 경고한다', () => {
    const bad = grid.map((r: unknown[]) => [...r]);
    bad[6][8] = 999; // 학생01 합계
    const p = parseGrid(roundTrip(bad), 'bad.xlsx');
    expect(p.integrity.some((i) => i.message.startsWith('번호 1: 합계 불일치'))).toBe(true);
  });

  it('8과목 시험도 같은 방식으로 읽는다', () => {
    const subjects = ['국어', '역사', '도덕', '수학', '과학', '기술·가정', '영어', '한문'];
    const g = makeExamGrid({ subjects, students: [{ no: 1, sid: 1, name: '학생01', scores: subjects.map(() => 50) }], gradeMeans: subjects.map(() => 50) });
    expect(parseGrid(roundTrip(g), 'x.xlsx').timepoints[0].subjects).toEqual(subjects);
  });
});

describe('학기 성적 파일', () => {
  const files = makeFakeClass({ seed: 3, nStudents: 6, transferNo: 6 });
  const total = files.find((f: { name: string }) => f.name.includes('total'));
  const pf = parseGrid(roundTrip(total.grid), total.name);

  it('학년·학기별 시점으로 나누고 P만 있는 학기는 제외한다', () => {
    expect(pf.kind).toBe('semester');
    expect(pf.timepoints.map((t) => [t.grade, t.semester])).toEqual([[1, 1], [2, 1]]);
    expect(pf.notices.some((n) => n.startsWith('1학년 2학기'))).toBe(true);
  });

  it('forward-fill과 쪽 나눔 반복 헤더를 처리해 학생·과목당 1행만 남긴다', () => {
    const tp = pf.timepoints[0];
    expect(tp.records.length).toBe(6 * 8);
    expect(new Set(tp.records.map((r) => r.name)).size).toBe(6);
  });

  it('원점수/과목평균 문자열을 나누고 성취도 전용 섹션은 무시한다', () => {
    const tp = pf.timepoints[0];
    const r = tp.records.find((x) => x.name === '학생01' && x.subject === '수학')!;
    expect(r.gradeMean).toBe(70.5);
    expect(r.gradeN).toBe(194);
    expect(typeof r.score).toBe('number');
    expect(tp.subjects).not.toContain('체육');
    expect(tp.subjects).not.toContain('보건');
    expect(pf.timepoints[1].subjects).toContain('역사');
    expect(tp.subjects).toContain('사회');
  });

  it('전입생의 빈 점수는 결측으로 남는다', () => {
    const r = pf.timepoints[0].records.filter((x) => x.no === 6);
    expect(r.every((x) => x.score === null)).toBe(true);
    expect(r[0].note).toBe('전입학');
  });

  it('학급 정보를 읽는다', () => {
    expect(pf.timepoints[0].classLabel).toBe('2학년 7반');
  });

  it('쪽 나눔이 학생 중간에 와도 학생 정보가 이어진다', () => {
    const g = makeSemesterGrid({ students: [{ no: 1, name: '학생01', periods: [{ grade: 1, semester: 1, rows: Array.from({ length: 5 }, (_, i) => ({ area: '국어', subject: `과목${i}`, score: 50 + i, mean: 60, ach: 'E', n: 10 })) }] }], pageRows: 2 });
    const p = parseGrid(roundTrip(g), 't.xlsx');
    expect(p.timepoints[0].records.map((r) => r.score)).toEqual([50, 51, 52, 53, 54]);
  });
});

describe('형식 감지', () => {
  it('알 수 없는 형식은 오류', () => {
    expect(() => parseGrid([['a', 'b'], [1, 2]], 'x.xlsx')).toThrow(/형식/);
  });
});
