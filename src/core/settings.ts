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

export const DEFAULT_SETTINGS: Settings = {
  trendThreshold: 0.5,
  alertDrop: -1.0,
  alertLowZ: -1.5,
  minN: 5,
  cutoffs: [90, 80, 70, 60],
  groups: [
    { name: '국어', subjects: ['국어'] },
    { name: '수학', subjects: ['수학'] },
    { name: '영어', subjects: ['영어'] },
    { name: '사회', subjects: ['사회', '역사', '도덕'] },
    { name: '과학', subjects: ['과학', '기술·가정', '정보'] },
  ],
  aliases: {},
};

const KEY = 'sta.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw) as Partial<Settings>;
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
