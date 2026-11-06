// 분석 설정. 개인정보가 없으므로 localStorage 저장을 허용한다(SPEC P4).

export interface Group {
  name: string;
  subjects: string[];
}

export interface Settings {
  /** 추세 라벨 기준 |Δz| */
  trendThreshold: number;
  /** 주의: 최근 Δz 이하 */
  alertDrop: number;
  /** 주의: 최근 과목 z 이하 */
  alertLowZ: number;
  /** z 계산 최소 인원 */
  minN: number;
  /** 성취도 A·B·C·D 하한(만점 대비 %) */
  cutoffs: [number, number, number, number];
  groups: Group[];
  /** 원래 과목명 → 비교용 과목명 */
  aliases: Record<string, string>;
}

/** 과목명 비교용 키: 공백과 가운뎃점(·・‧ㆍ)을 무시한다(예: '기술·가정' = '기술가정'). */
export const subjectKey = (s: string): string => s.replace(/[\s·・‧ㆍ.]/g, '');

/**
 * 기본 교과군: 2022 개정 교육과정 중학교 교과(군) 편제를 따른다(나이스 교과학습발달상황의 교과 구분과 같음).
 * 과목 목록은 교육과정 과목명과 나이스 표기를 함께 적었다.
 */
export const DEFAULT_GROUPS: Group[] = [
  { name: '국어', subjects: ['국어'] },
  { name: '수학', subjects: ['수학'] },
  { name: '영어', subjects: ['영어'] },
  { name: '사회·역사·도덕', subjects: ['사회', '지리', '일반사회', '역사', '도덕'] },
  { name: '과학·기술·정보', subjects: ['과학', '기술·가정', '정보'] },
  { name: '체육', subjects: ['체육'] },
  { name: '예술', subjects: ['음악', '미술'] },
  {
    name: '선택',
    subjects: ['한문', '환경', '진로와 직업', '보건', '생활 독일어', '생활 프랑스어', '생활 스페인어', '생활 중국어', '생활 일본어', '생활 러시아어', '생활 아랍어', '생활 베트남어'],
  },
];

/** 이전 버전 기본 교과군. 저장된 값이 이것과 같으면 새 기본값으로 바꾼다. */
export const LEGACY_DEFAULT_GROUPS: Group[] = [
  { name: '국어', subjects: ['국어'] },
  { name: '수학', subjects: ['수학'] },
  { name: '영어', subjects: ['영어'] },
  { name: '사회', subjects: ['사회', '역사', '도덕'] },
  { name: '과학', subjects: ['과학', '기술·가정', '정보'] },
];

export const DEFAULT_SETTINGS: Settings = {
  trendThreshold: 0.5,
  alertDrop: -1.0,
  alertLowZ: -1.5,
  minN: 5,
  cutoffs: [90, 80, 70, 60],
  groups: DEFAULT_GROUPS,
  aliases: {},
};

const KEY = 'sta.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw) as Partial<Settings>;
    if (s.groups && JSON.stringify(s.groups) === JSON.stringify(LEGACY_DEFAULT_GROUPS)) delete s.groups;
    return { ...structuredClone(DEFAULT_SETTINGS), ...s };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 불가 환경(사생활 보호 모드 등)에서는 무시 */
  }
}
