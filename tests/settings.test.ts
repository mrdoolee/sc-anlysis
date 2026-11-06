import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LEGACY_DEFAULT_GROUPS, loadSettings, subjectKey } from '../src/core/settings.ts';

/** 2022 개정 교육과정 중학교 교과별 과목(성취수준 취합기 기준) */
const CURRICULUM: Record<string, string[]> = {
  과학: ['과학'],
  국어: ['국어'],
  기술가정: ['기술가정'],
  도덕: ['도덕'],
  미술: ['미술'],
  사회: ['지리', '일반사회'],
  생활외국어: ['생활 독일어', '생활 프랑스어', '생활 스페인어', '생활 중국어', '생활 일본어', '생활 러시아어', '생활 아랍어', '생활 베트남어'],
  수학: ['수학'],
  역사: ['역사'],
  영어: ['영어'],
  음악: ['음악'],
  정보: ['정보'],
  '진로와 직업': ['진로와 직업'],
  체육: ['체육'],
  한문: ['한문'],
  환경: ['환경'],
};

describe('기본 교과군(2022 개정 교육과정)', () => {
  const groupOf = (subject: string) => DEFAULT_SETTINGS.groups.filter((g) => g.subjects.some((s) => subjectKey(s) === subjectKey(subject)));

  it('교육과정의 모든 과목이 정확히 한 교과군에 속한다', () => {
    for (const subjects of Object.values(CURRICULUM)) for (const s of subjects) expect(groupOf(s).map((g) => g.name), s).toHaveLength(1);
  });

  it('나이스 표기(기술·가정, 사회)도 같은 교과군으로 묶인다', () => {
    expect(groupOf('기술·가정')[0].name).toBe(groupOf('기술가정')[0].name);
    expect(groupOf('사회')[0].name).toBe(groupOf('역사')[0].name);
    expect(groupOf('도덕')[0].name).toBe(groupOf('역사')[0].name);
    expect(groupOf('정보')[0].name).toBe(groupOf('과학')[0].name);
    expect(groupOf('생활중국어')[0].name).toBe('선택');
  });

  it('주요 교과는 단독 묶음', () => {
    for (const s of ['국어', '수학', '영어']) expect(groupOf(s)[0].subjects).toEqual([s]);
  });
});

describe('subjectKey', () => {
  it('공백·가운뎃점을 무시한다', () => {
    expect(subjectKey('기술·가정')).toBe(subjectKey('기술가정'));
    expect(subjectKey('생활 중국어')).toBe(subjectKey('생활중국어'));
    expect(subjectKey('기술・가정')).toBe(subjectKey('기술 가정'));
  });
});

describe('저장된 설정 불러오기', () => {
  const g = globalThis as unknown as { localStorage?: Storage };
  const original = g.localStorage;
  afterEach(() => {
    g.localStorage = original;
  });
  const fake = (value: unknown) => {
    const store = new Map([['sta.settings.v1', JSON.stringify(value)]]);
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
  };

  it('예전 기본 교과군을 그대로 쓰던 경우 새 기본값으로 바꾼다', () => {
    fake({ trendThreshold: 0.7, groups: LEGACY_DEFAULT_GROUPS });
    const s = loadSettings();
    expect(s.groups).toEqual(DEFAULT_SETTINGS.groups);
    expect(s.trendThreshold).toBe(0.7);
  });

  it('사용자가 고친 교과군은 그대로 둔다', () => {
    const mine = [{ name: '주요', subjects: ['국어', '수학'] }];
    fake({ groups: mine });
    expect(loadSettings().groups).toEqual(mine);
  });
});
