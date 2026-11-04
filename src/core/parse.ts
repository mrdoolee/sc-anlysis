// 성적 파일 형식 감지와 파싱. 열 위치는 헤더 이름으로 찾는다(특정 학년·과목 수에 의존하지 않음).
import type { Cell, Grid, Issue, ParsedFile, RawRecord, RawTimepoint } from './types.ts';

export const norm = (v: Cell): string => (v == null ? '' : String(v).replace(/\s+/g, ''));
const text = (v: Cell): string => (v == null ? '' : String(v).trim());

export function toNum(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  return null;
}

/** '196 명' 같은 문자열에서 첫 숫자를 읽는다. */
const leadingNum = (v: Cell): number | null => {
  if (typeof v === 'number') return v;
  const m = /-?\d+(\.\d+)?/.exec(text(v));
  return m ? Number(m[0]) : null;
};

const TOL = 0.05 + 1e-9;

export interface ExamMeta {
  year: number | null;
  semester: number | null;
  grade: number | null;
  cls: number | null;
  round: number | null;
}

export function parseExamMeta(s: string): ExamMeta {
  const pick = (re: RegExp) => {
    const m = re.exec(s);
    return m ? Number(m[1]) : null;
  };
  return {
    year: pick(/(\d{4})\s*학년도/),
    semester: pick(/(\d)\s*학기/),
    grade: pick(/(\d)\s*학년(?!도)/),
    cls: pick(/(\d+)\s*반/),
    round: pick(/(\d+)\s*회\s*고사/) ?? pick(/(\d+)\s*차/),
  };
}

export function parseGrid(grid: Grid, fileName: string): ParsedFile {
  for (let r = 0; r < Math.min(grid.length, 40); r++) {
    const cells = (grid[r] ?? []).map(norm);
    if (cells.includes('성명') && cells.includes('합계')) return parseExam(grid, r, fileName);
    if (cells[0] === '번호' && cells.includes('과목')) return parseSemester(grid, fileName);
  }
  throw new Error(`${fileName}: 지원하는 성적표 형식을 찾지 못했습니다('성명'·'합계' 헤더 또는 '번호'·'과목' 헤더 필요).`);
}

const SUMMARY = new Set(['응시생수', '총점', '평균', '학년응시생수', '학년총점', '학년평균']);

function parseExam(grid: Grid, h: number, fileName: string): ParsedFile {
  const header = grid[h].map(norm);
  const noCol = header.indexOf('번호');
  const nameCol = header.indexOf('성명');
  const totalCol = header.indexOf('합계');
  const avgCol = header.indexOf('평균', totalCol);
  const idCol = noCol >= 0 && nameCol - noCol >= 2 ? noCol + 1 : -1;
  const subjCols: number[] = [];
  for (let c = nameCol + 1; c < totalCol; c++) if (header[c]) subjCols.push(c);
  const subjects = subjCols.map((c) => text(grid[h][c]));

  const maxRow = grid[h + 1] ?? [];
  const max = subjCols.map((c) => {
    const m = /만점\s*:?\s*(\d+(\.\d+)?)/.exec(text(maxRow[c]));
    return m ? Number(m[1]) : 100;
  });

  const metaText = grid
    .slice(0, h)
    .flatMap((row) => row.filter((c) => typeof c === 'string'))
    .join(' ');
  const meta = parseExamMeta(metaText);
  const firstCol = noCol >= 0 ? noCol : 0;

  const students: { no: number | null; sid: string | null; name: string; scores: (number | null)[]; total: number | null; avg: number | null }[] = [];
  const summary: Record<string, Cell[]> = {};
  for (let r = h + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const label = norm(row[firstCol]);
    if (SUMMARY.has(label)) {
      summary[label] = row;
      continue;
    }
    const no = toNum(row[noCol]);
    const name = text(row[nameCol]);
    if (no === null || !name || Object.keys(summary).length) continue;
    const sidCell = idCol >= 0 ? row[idCol] : null;
    students.push({
      no,
      sid: sidCell == null || sidCell === '' ? null : String(typeof sidCell === 'number' ? Math.round(sidCell) : sidCell).trim(),
      name,
      scores: subjCols.map((c) => toNum(row[c])),
      total: toNum(row[totalCol]),
      avg: avgCol >= 0 ? toNum(row[avgCol]) : null,
    });
  }

  const gradeMean = subjCols.map((c) => (summary['학년평균'] ? toNum(summary['학년평균'][c]) : null));
  const gradeN = subjCols.map((c) => (summary['학년응시생수'] ? leadingNum(summary['학년응시생수'][c]) : null));

  const records: RawRecord[] = [];
  for (const s of students) {
    subjects.forEach((subject, i) =>
      records.push({
        no: s.no, sid: s.sid, name: s.name, subject, area: null,
        score: s.scores[i], max: max[i], gradeMean: gradeMean[i], gradeN: gradeN[i],
        achievement: null, note: null,
      }),
    );
  }

  const integrity: Issue[] = [];
  const issue = (message: string) => integrity.push({ fileName, message });
  for (const s of students) {
    const present = s.scores.filter((x): x is number => x !== null);
    const sum = present.reduce((a, b) => a + b, 0);
    if (s.total !== null && Math.abs(sum - s.total) > TOL) issue(`번호 ${s.no}: 합계 불일치(차이 ${(s.total - sum).toFixed(2)})`);
    if (s.avg !== null && present.length && Math.abs(sum / present.length - s.avg) > TOL)
      issue(`번호 ${s.no}: 평균 불일치(차이 ${(s.avg - sum / present.length).toFixed(2)})`);
    if (present.length < subjects.length) issue(`번호 ${s.no}: 빈 점수 ${subjects.length - present.length}과목(결측으로 처리)`);
  }
  subjCols.forEach((c, i) => {
    const vals = students.map((s) => s.scores[i]).filter((x): x is number => x !== null);
    const sum = vals.reduce((a, b) => a + b, 0);
    const fileTotal = summary['총점'] ? toNum(summary['총점'][c]) : null;
    const fileMean = summary['평균'] ? toNum(summary['평균'][c]) : null;
    const fileN = summary['응시생수'] ? leadingNum(summary['응시생수'][c]) : null;
    if (fileTotal !== null && Math.abs(fileTotal - sum) > TOL) issue(`${subjects[i]}: 학급 총점 불일치(차이 ${(fileTotal - sum).toFixed(2)})`);
    if (fileMean !== null && vals.length && Math.abs(fileMean - sum / vals.length) > TOL)
      issue(`${subjects[i]}: 학급 평균 불일치(차이 ${(fileMean - sum / vals.length).toFixed(2)})`);
    if (fileN !== null && fileN !== vals.length) issue(`${subjects[i]}: 응시생수 불일치(파일 ${fileN}명, 점수 ${vals.length}명)`);
  });

  const tp: RawTimepoint = {
    kind: 'exam',
    year: meta.year, grade: meta.grade, semester: meta.semester, round: meta.round,
    classLabel: meta.grade && meta.cls ? `${meta.grade}학년 ${meta.cls}반` : null,
    subjects, records,
  };
  const notices: string[] = [];
  if (meta.grade === null || meta.round === null) notices.push('제목에서 학년 또는 회차를 읽지 못했습니다. 데이터 확인 화면에서 지정하세요.');
  return { fileName, kind: 'exam', timepoints: [tp], notices, integrity };
}

function parseSemester(grid: Grid, fileName: string): ParsedFile {
  let col: Record<string, number> | null = null;
  let numeric = false;
  let classLabel: string | null = null;
  const cur = { no: null as number | null, name: '', grade: null as number | null, sem: null as number | null };
  const groups = new Map<string, { grade: number; sem: number; records: RawRecord[] }>();
  const notices: string[] = [];

  for (const row of grid) {
    if (!row) continue;
    const c0 = norm(row[0]);
    if (c0 === '번호') {
      col = {};
      row.forEach((c, i) => {
        const k = norm(c);
        if (k && !(k in col!)) col![k] = i;
      });
      numeric = '원점수/과목평균' in col;
      continue;
    }
    if (!col) {
      const m = /(\d)\s*학년\s*(\d+)\s*반/.exec(row.map(text).join(' '));
      if (m && !classLabel) classLabel = `${m[1]}학년 ${m[2]}반`;
      continue;
    }
    if (c0.startsWith('<')) continue;
    const get = (k: string) => (col![k] === undefined ? null : row[col![k]]);
    const no = toNum(get('번호'));
    if (no !== null && no !== cur.no) {
      cur.no = no;
      cur.grade = null;
      cur.sem = null;
    }
    const name = text(get('성명'));
    if (name) cur.name = name;
    const g = toNum(get('학년'));
    if (g !== null) cur.grade = g;
    const s = toNum(get('학기'));
    if (s !== null) cur.sem = s;
    const subject = text(get('과목'));
    if (!numeric || !subject || cur.no === null || cur.grade === null || cur.sem === null || !cur.name) continue;

    const pair = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(text(get('원점수/과목평균')));
    const key = `${cur.grade}-${cur.sem}`;
    if (!groups.has(key)) groups.set(key, { grade: cur.grade, sem: cur.sem, records: [] });
    const ach = text(get('성취도'));
    const note = text(get('비고'));
    groups.get(key)!.records.push({
      no: cur.no, sid: null, name: cur.name, subject, area: text(get('교과')) || null,
      score: pair ? Number(pair[1]) : null, max: 100,
      gradeMean: pair ? Number(pair[2]) : null,
      gradeN: toNum(get('수강자수')),
      achievement: ach || null, note: note && note !== '/' ? note : null,
    });
  }

  const timepoints: RawTimepoint[] = [];
  for (const g of [...groups.values()].sort((a, b) => a.grade - b.grade || a.sem - b.sem)) {
    const scored = new Set(g.records.filter((r) => r.score !== null).map((r) => r.subject));
    if (!scored.size) {
      notices.push(`${g.grade}학년 ${g.sem}학기: 수치 점수가 없어(성취도 P 등) 분석에서 제외했습니다.`);
      continue;
    }
    const subjects = [...new Set(g.records.map((r) => r.subject))].filter((s) => scored.has(s));
    // 같은 학생·과목이 쪽 나눔으로 두 번 나오면 첫 행만 사용
    const seen = new Set<string>();
    const records = g.records.filter((r) => {
      const k = `${r.no}|${r.name}|${r.subject}`;
      if (!scored.has(r.subject) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    timepoints.push({ kind: 'semester', year: null, grade: g.grade, semester: g.sem, round: null, classLabel, subjects, records });
  }
  if (!timepoints.length) notices.push('수치 점수가 있는 학기를 찾지 못했습니다.');
  return { fileName, kind: 'semester', timepoints, notices, integrity: [] };
}
