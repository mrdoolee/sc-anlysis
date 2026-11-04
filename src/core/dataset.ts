// 여러 파일의 파싱 결과를 하나의 정규화 데이터셋(학생 × 시점 × 과목)으로 합친다.
import type { Issue, ParsedFile, TpKind } from './types.ts';

export interface Timepoint {
  id: string;
  kind: TpKind;
  year: number | null;
  grade: number | null;
  semester: number | null;
  round: number | null;
  label: string;
  fileName: string;
  /** 비교용(별칭 적용) 과목명 */
  subjects: string[];
  classLabel: string | null;
}

export interface Student {
  key: string;
  name: string;
  /** 파일마다 기재된 번호(서로 다르면 경고) */
  nos: number[];
  sid: string | null;
  note: string | null;
}

export interface Score {
  studentKey: string;
  tpId: string;
  subject: string;
  rawSubject: string;
  area: string | null;
  score: number | null;
  max: number;
  gradeMean: number | null;
  gradeN: number | null;
  achievement: string | null;
}

export interface TpOverride {
  label?: string;
  kind?: TpKind;
  grade?: number | null;
  semester?: number | null;
  round?: number | null;
}

export interface DatasetOptions {
  aliases: Record<string, string>;
  /** 학생키 → 합칠 대상 학생키 */
  merges: Record<string, string>;
  tpOrder?: string[];
  tpOverrides?: Record<string, TpOverride>;
}

export interface Dataset {
  timepoints: Timepoint[];
  students: Student[];
  scores: Score[];
  /** tpId → 과목 → 학생키 → 점수 */
  byTp: Map<string, Map<string, Map<string, Score>>>;
  issues: Issue[];
  notices: Issue[];
  classLabel: string | null;
}

export const KIND_LABEL: Record<TpKind, string> = { exam: '고사', semester: '학기 성적' };

export function defaultLabel(t: Pick<Timepoint, 'kind' | 'grade' | 'semester' | 'round'>): string {
  const g = t.grade ?? '?';
  const s = t.semester ?? '?';
  return t.kind === 'exam' ? `${g}학년 ${s}학기 ${t.round ?? '?'}회고사` : `${g}학년 ${s}학기 성적`;
}

const nameKey = (name: string) => name.replace(/\s+/g, '');

export function buildDataset(files: ParsedFile[], opts: DatasetOptions): Dataset {
  const issues: Issue[] = [];
  const notices: Issue[] = [];
  const alias = (s: string) => opts.aliases[s] || s;

  // 한 시점 안에서 이름이 겹치는 학생은 모든 파일에서 '이름#번호'로 구분한다.
  const dupNames = new Set<string>();
  for (const f of files)
    for (const tp of f.timepoints) {
      const seen = new Map<string, Set<number | null>>();
      for (const r of tp.records) {
        const k = nameKey(r.name);
        if (!seen.has(k)) seen.set(k, new Set());
        seen.get(k)!.add(r.no);
      }
      for (const [k, nos] of seen) if (nos.size > 1) dupNames.add(k);
    }
  const keyOf = (name: string, no: number | null) => {
    const k = nameKey(name);
    const base = dupNames.has(k) ? `${k}#${no ?? '?'}` : k;
    return opts.merges[base] ?? base;
  };

  const timepoints: Timepoint[] = [];
  const students = new Map<string, Student>();
  const scores: Score[] = [];
  const byTp = new Map<string, Map<string, Map<string, Score>>>();
  let classLabel: string | null = null;

  for (const f of files) {
    for (const n of f.notices) notices.push({ fileName: f.fileName, message: n });
    issues.push(...f.integrity);
    for (const raw of f.timepoints) {
      const id = `${f.fileName}#${raw.kind}-${raw.grade ?? 'x'}-${raw.semester ?? 'x'}-${raw.round ?? 'x'}`;
      const ov = opts.tpOverrides?.[id] ?? {};
      const meta = {
        kind: ov.kind ?? raw.kind,
        grade: ov.grade !== undefined ? ov.grade : raw.grade,
        semester: ov.semester !== undefined ? ov.semester : raw.semester,
        round: ov.round !== undefined ? ov.round : raw.round,
      };
      const subjects = [...new Set(raw.subjects.map(alias))];
      const tp: Timepoint = { id, ...meta, year: raw.year, label: ov.label || defaultLabel(meta), fileName: f.fileName, subjects, classLabel: raw.classLabel };
      if (raw.kind === 'exam' && raw.classLabel) classLabel = raw.classLabel;
      classLabel ??= raw.classLabel;
      const dup = timepoints.find((t) => t.kind === tp.kind && t.grade === tp.grade && t.semester === tp.semester && t.round === tp.round);
      if (dup) issues.push({ fileName: f.fileName, message: `'${tp.label}' 시점이 '${dup.fileName}'과 겹칩니다. 데이터 확인에서 시점 정보를 수정하세요.` });
      timepoints.push(tp);
      const table = new Map<string, Map<string, Score>>();
      byTp.set(id, table);
      for (const r of raw.records) {
        const key = keyOf(r.name, r.no);
        let st = students.get(key);
        if (!st) {
          st = { key, name: r.name.trim(), nos: [], sid: null, note: null };
          students.set(key, st);
        }
        if (r.no !== null && !st.nos.includes(r.no)) st.nos.push(r.no);
        if (r.sid && !st.sid) st.sid = r.sid;
        if (r.note && !st.note) st.note = r.note;
        const subject = alias(r.subject);
        if (!table.has(subject)) table.set(subject, new Map());
        const cell = table.get(subject)!;
        if (cell.has(key)) {
          if (cell.get(key)!.rawSubject !== r.subject)
            issues.push({ fileName: f.fileName, message: `${tp.label}: '${r.subject}'와 '${cell.get(key)!.rawSubject}'가 같은 과목으로 묶여 있어 앞의 것만 사용합니다.` });
          continue;
        }
        const s: Score = {
          studentKey: key, tpId: id, subject, rawSubject: r.subject, area: r.area,
          score: r.score, max: r.max, gradeMean: r.gradeMean, gradeN: r.gradeN, achievement: r.achievement,
        };
        cell.set(key, s);
        scores.push(s);
      }
    }
  }

  const rank = (t: Timepoint) => [t.grade ?? 99, t.semester ?? 9, t.kind === 'exam' ? 0 : 1, t.round ?? 0];
  timepoints.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
  if (opts.tpOrder?.length) {
    const pos = (id: string) => {
      const i = opts.tpOrder!.indexOf(id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    timepoints.sort((a, b) => pos(a.id) - pos(b.id));
  }

  const list = [...students.values()].sort((a, b) => (a.nos[0] ?? 1e9) - (b.nos[0] ?? 1e9) || a.name.localeCompare(b.name, 'ko'));
  for (const s of list) if (s.nos.length > 1) issues.push({ fileName: '-', message: `${s.name}: 파일마다 번호가 다릅니다(${s.nos.join(', ')}). 동일 학생이 맞는지 확인하세요.` });
  return { timepoints, students: list, scores, byTp, issues, notices, classLabel };
}

export interface AliasSuggestion {
  from: string;
  to: string;
  reason: string;
}

/** 같은 교과에 속하면서 한 시점에 함께 나오지 않는 과목 쌍을 별칭 후보로 제안한다(예: 사회 → 역사). */
export function suggestAliases(ds: Dataset): AliasSuggestion[] {
  const areaOf = new Map<string, string>();
  const tpsOf = new Map<string, Set<string>>();
  const firstOrder = new Map<string, number>();
  ds.timepoints.forEach((tp, i) => {
    for (const [subject, cells] of ds.byTp.get(tp.id) ?? []) {
      if (!tpsOf.has(subject)) tpsOf.set(subject, new Set());
      tpsOf.get(subject)!.add(tp.id);
      if (!firstOrder.has(subject)) firstOrder.set(subject, i);
      const area = cells.values().next().value?.area;
      if (area && !areaOf.has(subject)) areaOf.set(subject, area);
    }
  });
  const out: AliasSuggestion[] = [];
  const subjects = [...tpsOf.keys()];
  for (const a of subjects)
    for (const b of subjects) {
      if (a === b || !areaOf.get(a) || areaOf.get(a) !== areaOf.get(b)) continue;
      if ((firstOrder.get(a) ?? 0) >= (firstOrder.get(b) ?? 0)) continue;
      const ta = tpsOf.get(a)!;
      const tb = tpsOf.get(b)!;
      if ([...ta].some((t) => tb.has(t))) continue;
      out.push({ from: a, to: b, reason: `같은 교과(${areaOf.get(a)})이고 같은 시점에 함께 나오지 않음` });
    }
  return out;
}
