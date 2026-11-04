// 가짜 성적 데이터 생성기. 실제 학생 정보는 전혀 포함하지 않는다(이름은 '학생01' 형식).
// 테스트·E2E·시연에서 sample_data와 같은 구조의 xlsx를 만든다.
import { zipSync, strToU8 } from 'fflate';

/** 결정적 난수(mulberry32) */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (x) => Math.round(x * 10) / 10;
const pad = (n) => String(n).padStart(2, '0');

function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Grid(2차원 배열) → xlsx 바이트 */
export function writeXlsx(grid) {
  const sst = [];
  const idx = new Map();
  const rows = grid
    .map((row, r) => {
      const cells = (row ?? [])
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (v === null || v === undefined) return `<c r="${ref}"/>`;
          if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
          if (!idx.has(v)) {
            idx.set(v, sst.length);
            sst.push(v);
          }
          return `<c r="${ref}" t="s"><v>${idx.get(v)}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const ns = 'http://schemas.openxmlformats.org';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets><sheet name="sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${ns}/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    ),
    'xl/sharedStrings.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${ns}/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`,
    ),
  });
}

/**
 * 고사(가로형) 시트.
 * students: [{ no, sid, name, scores: (number|null)[] }]
 */
export function makeExamGrid({ year = 2026, semester = 1, grade = 2, cls = 7, round = 1, subjects, students, gradeMeans, gradeN = 196 }) {
  const w = subjects.length + 5;
  const blank = () => Array(w).fill(null);
  const g = [];
  const r0 = blank();
  r0[w - 2] = '2026.01.01.';
  g.push(r0);
  const r1row = blank();
  r1row[3] = '정기고사 학급별 일람표';
  g.push(r1row);
  const r2 = blank();
  r2[0] = `${year}학년도  ${semester}학기  주간  ${grade}학년  ${cls}반`;
  g.push(r2);
  const r3 = blank();
  r3[0] = `고사 :   ${round}회고사`;
  g.push(r3);
  g.push(['번호', null, '성명', ...subjects, '합 계', ' 평균']);
  g.push([null, null, null, ...subjects.map(() => '만점:100'), null, null]);
  for (const s of students) {
    const present = s.scores.filter((x) => x !== null);
    const total = r1(present.reduce((a, b) => a + b, 0));
    g.push([s.no, s.sid, s.name, ...s.scores.map((x) => (x === null ? '' : x)), total, present.length ? r1(total / present.length) : '']);
  }
  const colVals = subjects.map((_, i) => students.map((s) => s.scores[i]).filter((x) => x !== null));
  const sum = colVals.map((v) => r1(v.reduce((a, b) => a + b, 0)));
  g.push(['응시생수', null, null, ...colVals.map((v) => `${v.length} 명`), '', '']);
  g.push(['총      점', null, null, ...sum, null, null]);
  g.push(['평      균', null, null, ...colVals.map((v, i) => r1(sum[i] / v.length)), null, null]);
  g.push(['학년응시생수', null, null, ...subjects.map(() => `${gradeN} 명`), '', '']);
  g.push(['학년총점', null, null, ...gradeMeans.map((m) => r1(m * gradeN)), null, null]);
  g.push(['학년평균', null, null, ...gradeMeans, null, null]);
  const last = blank();
  last[4] = 1;
  last[5] = '/';
  last[6] = 1;
  g.push(last);
  return g;
}

const HEADER = ['번 호', '성  명', '학 년', '학 기', ' 교 과 ', '과 목', '원점수/과목평균', '성취도', '수강자수', '비 고'];

/**
 * 학기 성적(세로형) 시트.
 * students: [{ no, name, note?, periods: [{ grade, semester, rows: [{ area, subject, score|null, mean, ach, n }] }] }]
 * pageRows 마다 쪽번호 행과 헤더 행을 끼워 넣는다.
 */
export function makeSemesterGrid({ grade = 2, cls = 7, students, pageRows = 24, artSection = true }) {
  const g = [];
  g.push([null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, '2026.01.01.']);
  g.push([null, null, null, '학교생활기록부 교과학습발달상황']);
  g.push([`${grade}학년 ${cls}반`, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, '사용자명 : 교사']);
  g.push([...HEADER]);
  let inPage = 0;
  let page = 1;
  const push = (row, studentHead) => {
    if (inPage >= pageRows) {
      g.push([null, null, null, null, null, null, null, null, page++, '/', 30]);
      g.push([...HEADER]);
      inPage = 0;
      // 쪽이 바뀌면 학생 정보가 다시 적힌다
      row = [studentHead[0], studentHead[1], studentHead[2], studentHead[3], ...row.slice(4)];
    }
    g.push(row);
    inPage++;
  };
  for (const s of students) {
    let firstOfStudent = true;
    for (const p of s.periods) {
      let firstOfPeriod = true;
      for (const r of p.rows) {
        const pair = r.score === null ? '' : `${r.score}/${r.mean}`;
        const row = [
          firstOfStudent ? s.no : null,
          firstOfStudent ? s.name : null,
          firstOfPeriod && (firstOfStudent || p.grade !== s.periods[0].grade) ? p.grade : null,
          firstOfPeriod ? p.semester : null,
          r.area, r.subject, pair, r.ach, r.score === null ? '' : r.n, s.note ?? '',
        ];
        push(row, [s.no, s.name, p.grade, p.semester]);
        firstOfStudent = false;
        firstOfPeriod = false;
      }
    }
  }
  g.push([null, null, null, null, null, null, null, null, page, '/', 30]);
  if (artSection) {
    g.push(['< 체육·예술(음악/미술) >']);
    g.push(['번 호', '성  명', '학 년', '학 기', ' 교 과 ', '과 목', ' 성 취 도', '비 고']);
    for (const s of students) {
      g.push([s.no, s.name, 1, 1, '체육', '체육', 'A', s.note ?? '']);
      g.push([null, null, null, null, '예술(음악/미술)', '음악', 'B', '']);
    }
    g.push(['< 교양교과 >']);
    g.push(['번 호', '성  명', '학 년', '학 기', '교 과', '과 목', '이수시간', '이수여부', '비 고']);
    g.push([students[0].no, students[0].name, 1, 1, '선택', '보건', 17, 'P', '']);
  }
  return g;
}

export function achievement(score) {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'E';
}

/**
 * 학급 하나의 전체 가짜 데이터(학기 성적 1파일 + 고사 N파일).
 * 반환: [{ name: 파일명, grid }]
 */
export function makeFakeClass({ seed = 1, nStudents = 28, grade = 2, cls = 7, year = 2026, exams, prevSubjects, semSubjects, transferNo = null, absentNo = null } = {}) {
  const rand = rng(seed);
  const students = Array.from({ length: nStudents }, (_, i) => ({
    no: i + 1,
    sid: String(year - grade + 1) + String(100000 + seed * 1000 + i + 1).padStart(6, '0'),
    name: `학생${pad(i + 1)}`,
    ability: 40 + rand() * 55,
    drift: (rand() - 0.5) * 6,
  }));
  const score = (s, step) => {
    const v = s.ability + s.drift * step + (rand() - 0.5) * 16;
    return r1(Math.max(0, Math.min(100, v)));
  };
  exams ??= [
    { semester: 1, round: 1, subjects: ['국어', '역사', '수학', '과학', '영어'] },
    { semester: 1, round: 2, subjects: ['국어', '역사', '도덕', '수학', '과학', '기술·가정', '영어', '한문'] },
    { semester: 2, round: 3, subjects: ['국어', '역사', '수학', '과학', '영어'] },
  ];
  prevSubjects ??= [
    ['국어', '국어'], ['사회(역사포함)/도덕', '사회'], ['사회(역사포함)/도덕', '도덕'], ['수학', '수학'],
    ['과학/기술·가정/정보', '과학'], ['과학/기술·가정/정보', '기술·가정'], ['과학/기술·가정/정보', '정보'], ['영어', '영어'],
  ];
  semSubjects ??= [
    ['국어', '국어'], ['사회(역사포함)/도덕', '역사'], ['사회(역사포함)/도덕', '도덕'], ['수학', '수학'],
    ['과학/기술·가정/정보', '과학'], ['과학/기술·가정/정보', '기술·가정'], ['영어', '영어'], ['선택', '한문'],
  ];
  const files = [];
  const semRows = (s, list, step, isTransfer) =>
    list.map(([area, subject]) => {
      if (isTransfer) return { area, subject, score: null, mean: null, ach: '', n: null };
      const x = Math.round(score(s, step));
      return { area, subject, score: x, mean: 70.5, ach: achievement(x), n: 194 };
    });
  const semStudents = students.map((s) => ({
    no: s.no,
    name: s.name,
    note: s.no === transferNo ? '전입학' : '',
    periods: [
      { grade: grade - 1, semester: 1, rows: semRows(s, prevSubjects, 0, s.no === transferNo) },
      { grade: grade - 1, semester: 2, rows: prevSubjects.map(([area, subject]) => ({ area, subject, score: null, mean: null, ach: 'P', n: null })) },
      { grade, semester: 1, rows: semRows(s, semSubjects, 2, false) },
    ],
  }));
  files.push({ name: `${grade - 1}_total.xlsx`, grid: makeSemesterGrid({ grade, cls, students: semStudents }) });
  exams.forEach((e, k) => {
    const st = students.map((s) => ({
      no: s.no, sid: s.sid, name: s.name,
      scores: e.subjects.map(() => (s.no === absentNo && k === 0 ? null : score(s, k + 1))),
    }));
    files.push({
      name: `${grade}-${e.round}.xlsx`,
      grid: makeExamGrid({ year, semester: e.semester, grade, cls, round: e.round, subjects: e.subjects, students: st, gradeMeans: e.subjects.map(() => 62.5) }),
    });
  });
  return files;
}

/** 대용량 성능 시험용: nExams 회 고사, nSubjects 과목 */
export function makeLargeClass({ seed = 7, nStudents = 40, nExams = 20, nSubjects = 10 } = {}) {
  const subjects = Array.from({ length: nSubjects }, (_, i) => `과목${pad(i + 1)}`);
  const exams = Array.from({ length: nExams }, (_, i) => ({ semester: i % 2 === 0 ? 1 : 2, round: i + 1, subjects }));
  return makeFakeClass({ seed, nStudents, exams }).filter((f) => !f.name.includes('total'));
}
