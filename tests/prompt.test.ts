import { describe, expect, it } from 'vitest';
import { readXlsx } from '../src/core/xlsx.ts';
import { parseGrid } from '../src/core/parse.ts';
import { buildDataset } from '../src/core/dataset.ts';
import { buildMatrix } from '../src/core/analysis.ts';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';
import { classPrompt, studentPrompt } from '../src/core/prompt.ts';
// @ts-expect-error 타입 없는 .mjs 픽스처
import { makeFakeClass, rng, writeXlsx } from './fixtures/fake-data.mjs';

const files = makeFakeClass({ seed: 4, nStudents: 12 }).map((f: { name: string; grid: unknown[][] }) => parseGrid(readXlsx(writeXlsx(f.grid)), f.name));
const ds = buildDataset(files, { aliases: { 사회: '역사' }, merges: {} });
const ids = ds.timepoints.map((t) => t.id);
const m = buildMatrix(ds, ids, 'subject', DEFAULT_SETTINGS);
const label = (id: string) => ds.timepoints.find((t) => t.id === id)!.label;
const stu = ds.students[2];

/** 이름·학번·번호·반 같은 식별 정보가 들어 있지 않은지 */
function assertAnonymous(text: string) {
  for (const s of ds.students) {
    expect(text).not.toContain(s.name);
    if (s.sid) expect(text).not.toContain(s.sid);
  }
  expect(text).not.toMatch(/학생\d{2}/);
  expect(text).not.toMatch(/\d+\s*반/);
  expect(text).not.toMatch(/\d+\s*번/);
}

describe('LLM 프롬프트(학생)', () => {
  const text = studentPrompt(m, ds, stu.key, DEFAULT_SETTINGS, label);

  it('이름·학번·번호·반 정보가 없다', () => assertAnonymous(text));

  it('수치 데이터와 분석 요청을 담는다', () => {
    expect(text).toContain('# 데이터');
    expect(text).toContain('# 요청');
    expect(text).toContain('대상 학생');
    for (const id of ids) expect(text).toContain(label(id));
    const c = m.cell('국어', ids[0], stu.key)!;
    expect(text).toContain(c.raw!.toFixed(1));
    expect(text).toContain('학년 평균');
    expect(text).toMatch(/z/);
  });

  it('석차·백분위는 넣지 않는다', () => {
    expect(text).not.toMatch(/석차|백분위|등수/);
  });
});

describe('LLM 프롬프트(학급)', () => {
  const text = classPrompt(m, ds, DEFAULT_SETTINGS, label, rng(1));

  it('이름·학번·번호·반 정보가 없다', () => assertAnonymous(text));

  it('학생은 익명 코드로, 순서는 섞어서 넣는다', () => {
    const codes = text.match(/\bS\d{2}\b/g) ?? [];
    expect(new Set(codes).size).toBe(ds.students.length);
    const first = text.split('\n').find((l) => l.startsWith('| S01 |'))!;
    // 1번 학생의 첫 시점 평균과 S01 행이 항상 같지 않도록 섞는다(시드 1에서 확인)
    const v = m.cell('__avg', ids[0], ds.students[0].key)?.raw?.toFixed(1);
    expect(first.includes(`| ${v} |`)).toBe(false);
  });

  it('시점별 학급 통계를 담는다', () => {
    expect(text).toContain('학급 통계');
    expect(text).toContain(`학생 수 ${ds.students.length}명`);
  });
});
