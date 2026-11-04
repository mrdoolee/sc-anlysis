export type Cell = string | number | null;
export type Grid = Cell[][];

/** exam = 지필고사(회차), semester = 학기 종합 성적 */
export type TpKind = 'exam' | 'semester';

export interface RawRecord {
  no: number | null;
  sid: string | null;
  name: string;
  subject: string;
  /** 교과(학기 성적 파일에만 있음) */
  area: string | null;
  score: number | null;
  max: number;
  gradeMean: number | null;
  gradeN: number | null;
  /** 파일에 기재된 성취도 */
  achievement: string | null;
  note: string | null;
}

export interface RawTimepoint {
  kind: TpKind;
  year: number | null;
  grade: number | null;
  semester: number | null;
  round: number | null;
  classLabel: string | null;
  subjects: string[];
  records: RawRecord[];
}

export interface Issue {
  fileName: string;
  message: string;
}

export interface ParsedFile {
  fileName: string;
  kind: TpKind;
  timepoints: RawTimepoint[];
  /** 파싱 중 알림(점수 없는 학기 등) */
  notices: string[];
  /** 무결성 점검 경고 */
  integrity: Issue[];
}
