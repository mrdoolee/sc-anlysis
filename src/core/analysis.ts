// 분석 코어: 시나리오 프리셋, 지표 행렬(원점수·z·T·석차·백분위), 추세, 주의 학생, 학기종합↔고사 격차.
import type { Dataset, Timepoint } from './dataset.ts';
import { subjectKey, type Settings } from './settings.ts';
import { achievementOf, competitionRanks, mean, percentileRanks, popSd, present, quantile, slope, tScore } from './stats.ts';

export type Unit = 'subject' | 'group';
export type Metric = 'raw' | 'z' | 't' | 'zg';
export type Preset = 'S1' | 'S2' | 'S3' | 'S4' | 'custom';

export const AVG = '__avg';
export const METRIC_LABEL: Record<Metric, string> = { raw: '원점수', z: 'z점수(학급)', t: 'T점수(학급)', zg: 'z점수(학년, 입력 σ)' };
export const PRESET_LABEL: Record<Preset, string> = {
  S1: 'S1 학년 전환 비교',
  S2: 'S2 학년 내 고사 누계',
  S3: 'S3 전체 이력',
  S4: 'S4 두 시점 비교(A↔B)',
  custom: '사용자 지정',
};

export interface PresetOptions {
  grade?: number | null;
  a?: string | null;
  b?: string | null;
}

export function gradesOf(ds: Dataset): number[] {
  return [...new Set(ds.timepoints.map((t) => t.grade).filter((g): g is number => g !== null))].sort((a, b) => a - b);
}

/** 고사가 있는 가장 높은 학년(기본 대상 학년) */
export function defaultGrade(ds: Dataset): number | null {
  const g = ds.timepoints.filter((t) => t.kind === 'exam' && t.grade !== null).map((t) => t.grade!);
  return g.length ? Math.max(...g) : (gradesOf(ds).at(-1) ?? null);
}

export function presetTimepoints(ds: Dataset, preset: Preset, o: PresetOptions = {}): string[] {
  const tps = ds.timepoints;
  const g = o.grade ?? defaultGrade(ds);
  const ids = (xs: Timepoint[]) => xs.map((t) => t.id);
  switch (preset) {
    case 'S1': {
      if (g === null) return [];
      const prev = tps.filter((t) => t.grade === g - 1);
      const prevSem = prev.filter((t) => t.kind === 'semester');
      const firstExam = tps.find((t) => t.grade === g && t.kind === 'exam');
      return ids([...(prevSem.length ? prevSem : prev), ...(firstExam ? [firstExam] : [])]);
    }
    case 'S2': {
      const exams = tps.filter((t) => t.grade === g && t.kind === 'exam');
      return ids(exams.length ? exams : tps.filter((t) => t.grade === g));
    }
    case 'S3':
      return ids(tps);
    case 'S4': {
      const a = o.a ?? tps.at(-2)?.id;
      const b = o.b ?? tps.at(-1)?.id;
      return ids(tps.filter((t) => t.id === a || t.id === b));
    }
    default:
      return [];
  }
}

export interface Item {
  id: string;
  label: string;
}

export interface CellV {
  raw: number | null;
  max: number;
  z: number | null;
  t: number | null;
  zg: number | null;
  dev: number | null;
  rank: number | null;
  pr: number | null;
  achFile: string | null;
  achCalc: string | null;
}

export interface ItemStat {
  n: number;
  mean: number | null;
  sd: number | null;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  fullMark: number;
  gradeMean: number | null;
  gradeN: number | null;
  zReason: string | null;
  members: string[];
}

export interface Matrix {
  tpIds: string[];
  tps: Timepoint[];
  items: Item[];
  unit: Unit;
  /** 선택한 모든 시점에 있는 과목(공통 과목 평균 기준) */
  common: string[];
  students: string[];
  mixedKinds: boolean;
  cell(item: string, tp: string, student: string): CellV | undefined;
  stat(item: string, tp: string): ItemStat | undefined;
}

export function metricValue(c: CellV | undefined, m: Metric): number | null {
  if (!c) return null;
  return m === 'raw' ? c.raw : m === 'z' ? c.z : m === 't' ? c.t : c.zg;
}

/** gradeSigma 키: `${tpId}|${itemId}` */
export function buildMatrix(ds: Dataset, tpIds: string[], unit: Unit, settings: Settings, gradeSigma: Record<string, number> = {}): Matrix {
  const tps = ds.timepoints.filter((t) => tpIds.includes(t.id));
  const ids = tps.map((t) => t.id);
  const students = ds.students.map((s) => s.key);
  const subjCache = new Map<string, string[]>();
  const subjectsAt = (tp: string): string[] => {
    let v = subjCache.get(tp);
    if (!v) {
      const table = ds.byTp.get(tp) ?? new Map();
      v = [...table.keys()].filter((s) => present([...(table.get(s)?.values() ?? [])].map((x) => x.score)).length > 0);
      subjCache.set(tp, v);
    }
    return v;
  };
  const order: string[] = [];
  for (const id of ids) for (const s of subjectsAt(id)) if (!order.includes(s)) order.push(s);
  const common = order.filter((s) => ids.every((id) => subjectsAt(id).includes(s)));

  // 항목 정의: 항목 → 시점별 구성 과목
  const defs: { item: Item; membersAt: (tp: string) => string[]; derived: boolean }[] = [];
  if (unit === 'subject') {
    for (const s of order) defs.push({ item: { id: s, label: s }, membersAt: (tp) => (subjectsAt(tp).includes(s) ? [s] : []), derived: false });
  } else {
    const grouped = new Set<string>();
    for (const g of settings.groups) {
      const keys = new Set(g.subjects.map(subjectKey));
      const inGroup = (s: string) => keys.has(subjectKey(s));
      const members = order.filter(inGroup);
      if (!members.length) continue;
      members.forEach((m) => grouped.add(m));
      defs.push({ item: { id: `g:${g.name}`, label: g.name }, membersAt: (tp) => subjectsAt(tp).filter(inGroup), derived: true });
    }
    for (const s of order) if (!grouped.has(s)) defs.push({ item: { id: s, label: s }, membersAt: (tp) => (subjectsAt(tp).includes(s) ? [s] : []), derived: false });
  }
  defs.push({ item: { id: AVG, label: '공통 과목 평균' }, membersAt: () => common, derived: true });

  // 항목·시점·학생 위치로 찾는 평평한 배열(문자열 키를 만들지 않아 빠르다)
  const T = ids.length;
  const S = students.length;
  const itemIdx = new Map(defs.map((d, i) => [d.item.id, i]));
  const tpIdx = new Map(ids.map((id, i) => [id, i]));
  const stuIdx = new Map(students.map((s, i) => [s, i]));
  const cells: (CellV | undefined)[] = new Array(defs.length * T * S);
  const stats: (ItemStat | undefined)[] = new Array(defs.length * T);
  for (const [di, d] of defs.entries()) {
    for (const [ti, tp] of ids.entries()) {
      const members = d.membersAt(tp);
      const table = ds.byTp.get(tp)!;
      const values = students.map((stu): { v: number | null; max: number; achFile: string | null } => {
        if (!members.length) return { v: null, max: 100, achFile: null };
        if (!d.derived) {
          const s = table.get(members[0])?.get(stu);
          return { v: s?.score ?? null, max: s?.max ?? 100, achFile: s?.achievement ?? null };
        }
        const xs = members.map((m) => {
          const s = table.get(m)?.get(stu);
          return s && s.score !== null ? (s.score / s.max) * 100 : null;
        });
        return { v: xs.every((x) => x !== null) ? mean(xs as number[]) : null, max: 100, achFile: null };
      });
      const xs = present(values.map((v) => v.v));
      const mu = mean(xs);
      const sd = popSd(xs);
      const sorted = [...xs].sort((a, b) => a - b);
      const gms = members.map((m) => {
        const first = table.get(m)?.values().next().value;
        if (!first || first.gradeMean === null) return null;
        return d.derived ? (first.gradeMean / first.max) * 100 : first.gradeMean;
      });
      const gradeMean = gms.length && gms.every((x) => x !== null) ? mean(gms as number[]) : null;
      const gradeN = members.length === 1 ? (table.get(members[0])?.values().next().value?.gradeN ?? null) : null;
      const zReason = !xs.length ? '점수 없음' : xs.length < settings.minN ? `인원 부족(n=${xs.length} < ${settings.minN})` : sd === 0 ? '표준편차 0' : null;
      const fullMark = values.find((v) => v.v !== null)?.max ?? 100;
      stats[di * T + ti] = {
        n: xs.length, mean: mu, sd, min: sorted[0] ?? null, q1: quantile(sorted, 0.25), median: quantile(sorted, 0.5), q3: quantile(sorted, 0.75), max: sorted.at(-1) ?? null,
        fullMark, gradeMean, gradeN, zReason, members,
      };
      const ranks = competitionRanks(values.map((v) => v.v));
      const prs = percentileRanks(values.map((v) => v.v));
      const sigmaG = gradeSigma[`${tp}|${d.item.id}`];
      students.forEach((stu, i) => {
        const v = values[i].v;
        if (v === null) return;
        const z = zReason === null && mu !== null && sd ? (v - mu) / sd : null;
        cells[(di * T + ti) * S + i] = {
          raw: v, max: values[i].max, z, t: z === null ? null : tScore(z),
          zg: sigmaG && sigmaG > 0 && gradeMean !== null ? (v - gradeMean) / sigmaG : null,
          dev: gradeMean === null ? null : v - gradeMean,
          rank: ranks[i], pr: prs[i], achFile: values[i].achFile, achCalc: achievementOf(v, values[i].max, settings.cutoffs),
        };
      });
    }
  }
  return {
    tpIds: ids, tps, items: defs.map((d) => d.item), unit, common, students,
    mixedKinds: new Set(tps.map((t) => t.kind)).size > 1,
    cell: (item, tp, stu) => {
      const di = itemIdx.get(item);
      const ti = tpIdx.get(tp);
      const si = stuIdx.get(stu);
      return di === undefined || ti === undefined || si === undefined ? undefined : cells[(di * T + ti) * S + si];
    },
    stat: (item, tp) => {
      const di = itemIdx.get(item);
      const ti = tpIdx.get(tp);
      return di === undefined || ti === undefined ? undefined : stats[di * T + ti];
    },
  };
}

export type TrendLabel = '상승' | '하락' | '유지' | '판단 불가';

export interface Trend {
  values: (number | null)[];
  zs: (number | null)[];
  delta: number | null;
  deltaZ: number | null;
  slope: number | null;
  volatility: number | null;
  best: string | null;
  worst: string | null;
  label: TrendLabel;
}

const firstLast = (xs: (number | null)[]) => {
  const p = xs.map((x, i) => [x, i] as const).filter((q) => q[0] !== null);
  return p.length >= 2 ? [p[0][0] as number, p.at(-1)![0] as number] : null;
};

export function studentTrend(m: Matrix, item: string, stu: string, metric: Metric, settings: Settings): Trend {
  const cs = m.tpIds.map((tp) => m.cell(item, tp, stu));
  const values = cs.map((c) => metricValue(c, metric));
  const zs = cs.map((c) => c?.z ?? null);
  const fl = firstLast(values);
  const flz = firstLast(zs);
  const deltaZ = flz ? flz[1] - flz[0] : null;
  const zp = present(zs);
  let best: string | null = null;
  let worst: string | null = null;
  zs.forEach((z, i) => {
    if (z === null) return;
    if (best === null || z > (zs[m.tpIds.indexOf(best)] as number)) best = m.tpIds[i];
    if (worst === null || z < (zs[m.tpIds.indexOf(worst)] as number)) worst = m.tpIds[i];
  });
  const th = settings.trendThreshold;
  return {
    values, zs,
    delta: fl ? fl[1] - fl[0] : null,
    deltaZ,
    slope: slope(values),
    volatility: zp.length >= 2 ? popSd(zp) : null,
    best, worst,
    label: deltaZ === null ? '판단 불가' : deltaZ >= th ? '상승' : deltaZ <= -th ? '하락' : '유지',
  };
}

export function trendCounts(m: Matrix, item: string, settings: Settings): Record<TrendLabel, number> {
  const out: Record<TrendLabel, number> = { 상승: 0, 유지: 0, 하락: 0, '판단 불가': 0 };
  for (const s of m.students) out[studentTrend(m, item, s, 'z', settings).label]++;
  return out;
}

export interface Alert {
  student: string;
  reasons: string[];
}

export function alerts(m: Matrix, settings: Settings, labelOf: (tp: string) => string): Alert[] {
  const out: Alert[] = [];
  const last = m.tpIds.at(-1);
  for (const stu of m.students) {
    const reasons: string[] = [];
    const zs = m.tpIds.map((tp) => ({ tp, z: m.cell(AVG, tp, stu)?.z ?? null })).filter((x) => x.z !== null) as { tp: string; z: number }[];
    if (zs.length >= 2) {
      const d = zs.at(-1)!.z - zs.at(-2)!.z;
      if (d <= settings.alertDrop + 1e-9) reasons.push(`공통 과목 평균 z가 ${labelOf(zs.at(-2)!.tp)} → ${labelOf(zs.at(-1)!.tp)}에 ${d.toFixed(2)} 변화`);
    }
    if (zs.length >= 3) {
      const [a, b, c] = zs.slice(-3).map((x) => x.z);
      if (c < b && b < a) reasons.push('공통 과목 평균 z가 2회 연속 하락');
    }
    if (last)
      for (const it of m.items) {
        if (it.id === AVG) continue;
        const z = m.cell(it.id, last, stu)?.z;
        if (z !== undefined && z !== null && z <= settings.alertLowZ + 1e-9) reasons.push(`${labelOf(last)} ${it.label} z = ${z.toFixed(2)}`);
      }
    if (reasons.length) out.push({ student: stu, reasons });
  }
  return out;
}

export interface GapRow {
  subject: string;
  classGap: number | null;
  n: number;
  perStudent: Map<string, { sem: number; exam: number; gap: number }>;
}

export interface GapTable {
  semTp: Timepoint;
  examTps: Timepoint[];
  rows: GapRow[];
}

/** 같은 학년·학기의 학기 성적 − 그 학기 고사 평균 */
export function semesterGap(ds: Dataset, students: string[] = ds.students.map((s) => s.key)): GapTable[] {
  const out: GapTable[] = [];
  for (const semTp of ds.timepoints.filter((t) => t.kind === 'semester')) {
    const examTps = ds.timepoints.filter((t) => t.kind === 'exam' && t.grade === semTp.grade && t.semester === semTp.semester);
    if (!examTps.length) continue;
    const rows: GapRow[] = [];
    for (const subject of semTp.subjects) {
      if (!examTps.some((e) => ds.byTp.get(e.id)?.has(subject))) continue;
      const perStudent = new Map<string, { sem: number; exam: number; gap: number }>();
      for (const stu of students) {
        const s = ds.byTp.get(semTp.id)?.get(subject)?.get(stu);
        const ex = present(examTps.map((e) => ds.byTp.get(e.id)?.get(subject)?.get(stu)).map((x) => (x && x.score !== null ? (x.score / x.max) * 100 : null)));
        if (!s || s.score === null || !ex.length) continue;
        const sem = (s.score / s.max) * 100;
        const exam = mean(ex)!;
        perStudent.set(stu, { sem, exam, gap: sem - exam });
      }
      const gaps = [...perStudent.values()].map((v) => v.gap);
      rows.push({ subject, classGap: mean(gaps), n: gaps.length, perStudent });
    }
    if (rows.length) out.push({ semTp, examTps, rows });
  }
  return out;
}
