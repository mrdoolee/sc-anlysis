// 앱 상태와 화면. 상태가 바뀌면 현재 화면을 다시 그린다(이벤트는 위임 방식, 인라인 핸들러 없음).
import { AVG, METRIC_LABEL, PRESET_LABEL, buildMatrix, defaultGrade, gradesOf, presetTimepoints, type Matrix, type Metric, type Preset, type Unit } from '../core/analysis.ts';
import { buildDataset, suggestAliases, KIND_LABEL, type Dataset, type TpOverride } from '../core/dataset.ts';
import { parseGrid } from '../core/parse.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../core/settings.ts';
import type { ParsedFile, TpKind } from '../core/types.ts';
import { readXlsx } from '../core/xlsx.ts';
import { esc } from '../charts/svg.ts';
import { buildReportBody, exportHtmlDocument, type ExportScope } from '../report/report.ts';
import { PRIVACY_NOTE, alertsSection, anonymizer, classSections, footnotes, gapSection, parentReport, studentSections, type ViewCtx } from '../views/sections.ts';

type View = 'load' | 'check' | 'analyze' | 'export' | 'settings';
type Tab = 'student' | 'class' | 'alerts' | 'gap';

interface State {
  files: ParsedFile[];
  loadErrors: string[];
  settings: Settings;
  merges: Record<string, string>;
  tpOrder: string[];
  tpOverrides: Record<string, TpOverride>;
  /** 분석에서 뺀 시점 id(메모리에만 보관) */
  excludedTps: string[];
  /** 데이터 확인 화면에서 펼친 시점 */
  openTps: string[];
  /** 대시보드에서 접어 둔 차트 */
  collapsedCharts: string[];
  gradeSigma: Record<string, number>;
  ds: Dataset | null;
  view: View;
  tab: Tab;
  preset: Preset;
  grade: number | null;
  a: string | null;
  b: string | null;
  tpIds: string[];
  unit: Unit;
  metric: Metric;
  focus: string;
  student: string | null;
  hidden: string[];
  exportScope: ExportScope;
  exportSelected: string[];
  anonymize: boolean;
  message: string;
}

const initial = (): State => ({
  files: [], loadErrors: [], settings: loadSettings(), merges: {}, tpOrder: [], tpOverrides: {}, excludedTps: [], openTps: [], collapsedCharts: [], gradeSigma: {}, ds: null,
  view: 'load', tab: 'student', preset: 'S3', grade: null, a: null, b: null, tpIds: [], unit: 'subject', metric: 'raw', focus: AVG,
  student: null, hidden: [], exportScope: 'student', exportSelected: [], anonymize: false, message: '',
});

let state: State = initial();
let matrixCache: { key: string; m: Matrix } | null = null;

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T | null;

function rebuild(resetSelection = false): void {
  matrixCache = null;
  if (!state.files.length) {
    state.ds = null;
    return;
  }
  const ds = buildDataset(state.files, { aliases: state.settings.aliases, merges: state.merges, tpOrder: state.tpOrder, tpOverrides: state.tpOverrides, exclude: state.excludedTps });
  state.ds = ds;
  const ids = new Set(ds.timepoints.map((t) => t.id));
  if (state.grade === null || !gradesOf(ds).includes(state.grade)) state.grade = defaultGrade(ds);
  if (!state.a || !ids.has(state.a)) state.a = ds.timepoints.at(-2)?.id ?? null;
  if (!state.b || !ids.has(state.b)) state.b = ds.timepoints.at(-1)?.id ?? null;
  if (resetSelection || state.preset !== 'custom') applyPreset();
  else state.tpIds = ds.timepoints.filter((t) => state.tpIds.includes(t.id)).map((t) => t.id);
  if (!state.student || !ds.students.some((s) => s.key === state.student)) state.student = ds.students[0]?.key ?? null;
}

function applyPreset(): void {
  if (!state.ds || state.preset === 'custom') return;
  state.tpIds = presetTimepoints(state.ds, state.preset, { grade: state.grade, a: state.a, b: state.b });
}

function matrix(): Matrix | null {
  if (!state.ds) return null;
  const key = JSON.stringify([state.tpIds, state.unit, state.settings, state.gradeSigma]);
  if (matrixCache?.key !== key) matrixCache = { key, m: buildMatrix(state.ds, state.tpIds, state.unit, state.settings, state.gradeSigma) };
  return matrixCache.m;
}

function ctx(interactive: boolean, anonymize = false): ViewCtx | null {
  const m = matrix();
  if (!m || !state.ds) return null;
  const focus = m.items.some((i) => i.id === state.focus) ? state.focus : AVG;
  return { ds: state.ds, m, settings: state.settings, metric: state.metric, focus, hidden: new Set(state.hidden), interactive, anonymize, nameOf: anonymizer(state.ds, anonymize), collapsed: new Set(state.collapsedCharts) };
}

// ---------- 화면 ----------

const NAV: [View, string, string][] = [
  ['load', '1', '불러오기'],
  ['check', '2', '데이터 확인'],
  ['analyze', '3', '대시보드'],
  ['export', '4', '내보내기'],
  ['settings', '⚙', '설정'],
];

const TITLES: Record<View, [string, string]> = {
  load: ['성적 파일 불러오기', '고사 일람표·교과학습발달상황 xlsx'],
  check: ['데이터 확인', '시점 · 과목 매핑 · 학생 매칭 · 무결성'],
  analyze: ['성적 추세 대시보드', '시나리오와 학생을 골라 추세를 봅니다'],
  export: ['리포트 내보내기', '학생·학부모용 A4 1장 / 학급 요약'],
  settings: ['설정', '기준값 · 성취도 · 교과군'],
};

function renderNav(): string {
  const order: View[] = ['load', 'check', 'analyze', 'export'];
  const cur = order.indexOf(state.view);
  return NAV.map(([v, step, label]) => {
    const disabled = v !== 'load' && v !== 'settings' && !state.ds;
    const done = state.ds && order.indexOf(v) >= 0 && order.indexOf(v) < cur;
    return `<button type="button" id="nav-${v}" class="nav-btn${state.view === v ? ' active' : ''}${done ? ' done' : ''}" data-action="nav" data-view="${v}"${disabled ? ' disabled' : ''}${state.view === v ? ' aria-current="page"' : ''}><span class="step" aria-hidden="true">${done ? '✓' : step}</span>${label}</button>`;
  }).join('');
}

function renderTopbar(view: View): string {
  const [title, sub] = TITLES[view];
  const ds = state.ds;
  const pills = ds
    ? `<div class="stats"><span class="stat-pill">${esc(ds.classLabel ?? '학급')}</span><span class="stat-pill">파일 <b>${state.files.length}</b></span><span class="stat-pill">학생 <b>${ds.students.length}</b></span><span class="stat-pill">시점 <b>${ds.timepoints.length}</b></span>${ds.issues.length ? `<span class="stat-pill">점검 경고 <b>${ds.issues.length}</b></span>` : ''}</div>`
    : '';
  return `<div><h2>${esc(title)}</h2><p class="crumbs">${esc(sub)}</p></div>${pills}`;
}

function opt(value: string, label: string, selected: boolean): string {
  return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

const chip = (id: string, attrs: string, checked: boolean, label: string, type = 'checkbox', name = '') =>
  `<label class="chip"><input id="${id}" type="${type}"${name ? ` name="${name}"` : ''} ${attrs}${checked ? ' checked' : ''}><span>${label}</span></label>`;

function viewLoad(): string {
  const files = state.files
    .map((f) => `<li class="file-card"><div class="card-head"><strong>${esc(f.fileName)}</strong><span class="kind">${f.kind === 'exam' ? '고사' : '학기 성적'}</span></div><p class="meta">시점 ${f.timepoints.length}개 · ${esc(f.timepoints.map((t) => t.subjects.length).join('/'))}과목</p>${f.notices.length ? `<ul class="notes">${f.notices.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}<button type="button" class="small" data-action="remove-file" data-file="${esc(f.fileName)}">빼기</button></li>`)
    .join('');
  return `<div class="hero">
  <section class="card">
    <h2>파일을 끌어다 놓으세요</h2>
    <div id="drop" class="drop" tabindex="0" role="button" aria-label="파일을 끌어다 놓거나 눌러서 선택">
      <p><strong>xlsx 파일을 여기에 놓기</strong></p>
      <p class="meta">여러 파일을 한 번에 놓을 수 있습니다</p>
      <p><label class="btn" for="file-input">파일 선택</label></p>
      <input id="file-input" type="file" accept=".xlsx" multiple>
    </div>
    <p class="safe">파일은 업로드되지 않습니다. 이 브라우저 안에서만 읽고, 창을 닫거나 새로고침하면 성적 데이터는 사라집니다.</p>
  </section>
  <section class="card steps-help">
    <h2>지원 형식</h2>
    <ol>
      <li><strong>고사 일람표</strong>(가로형): 학급별 회차 시험 점수. 제목의 학년·학기·회차를 자동으로 읽습니다.</li>
      <li><strong>교과학습발달상황</strong>(세로형): 학기 성적. 학년·학기별로 나눠 읽습니다.</li>
      <li>학년은 정해져 있지 않습니다. 1~3학년 어떤 조합이든 됩니다.</li>
    </ol>
  </section>
</div>
${state.loadErrors.length ? `<div class="alert" role="alert"><ul>${state.loadErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
${files ? `<section class="card"><div class="card-head"><h2>불러온 파일 (${state.files.length})</h2><button type="button" class="button-primary" data-action="nav" data-view="check">다음: 데이터 확인 →</button></div><ul class="file-cards">${files}</ul></section>` : ''}`;
}

function viewCheck(): string {
  const ds = state.ds!;
  // 시점 하나 = 한 줄 상자. 펼치면 이름·유형·학년·학기·회차를 고칠 수 있다.
  const tpItems = ds.timepoints
    .map((t, i) => {
      const id = esc(t.id);
      const ov = state.tpOverrides[t.id] ?? {};
      const open = state.openTps.includes(t.id);
      const edited = ov.label || ov.kind || ov.grade !== undefined || ov.semester !== undefined || ov.round !== undefined;
      const panel = open
        ? `<div class="tp-edit" id="tpe-${i}">
        <div class="field"><label for="tpl-${i}">이름</label><input id="tpl-${i}" type="text" value="${esc(t.label)}" data-change="tp-label" data-id="${id}"></div>
        <div class="field"><label for="tpk-${i}">유형</label><select id="tpk-${i}" data-change="tp-kind" data-id="${id}">${(['exam', 'semester'] as TpKind[]).map((k) => opt(k, KIND_LABEL[k], t.kind === k)).join('')}</select></div>
        ${(['grade', 'semester', 'round'] as const).map((f) => `<div class="field"><label for="tp${f}-${i}">${f === 'grade' ? '학년' : f === 'semester' ? '학기' : '회차'}</label><input id="tp${f}-${i}" class="num" type="number" min="1" max="20" value="${t[f] ?? ''}" data-change="tp-meta" data-field="${f}" data-id="${id}"></div>`).join('')}
        <div class="field tp-subjects"><span class="group-label">과목 (${t.subjects.length})</span><span>${esc(t.subjects.join(', '))}</span></div>
      </div>`
        : '';
      return `<li class="tp-item${open ? ' open' : ''}">
      <div class="tp-line">
        <span class="tp-no" aria-hidden="true">${i + 1}</span>
        <button type="button" class="tp-toggle" id="tpo-${i}" data-action="tp-open" data-id="${id}" aria-expanded="${open}"${open ? ` aria-controls="tpe-${i}"` : ''}>
          <strong>${esc(t.label)}</strong>
          <span class="kind-badge ${t.kind}">${KIND_LABEL[t.kind]}</span>
          <span class="tp-meta">${t.subjects.length}과목 · ${esc(t.fileName)}${edited ? ' · 수정됨' : ''}</span>
          <span class="chev" aria-hidden="true">${open ? '접기 ▴' : '펼치기 ▾'}</span>
        </button>
        <span class="tp-actions">
          <button type="button" class="small" data-action="tp-move" data-id="${id}" data-dir="-1"${i === 0 ? ' disabled' : ''} aria-label="${esc(t.label)} 위로">▲</button>
          <button type="button" class="small" data-action="tp-move" data-id="${id}" data-dir="1"${i === ds.timepoints.length - 1 ? ' disabled' : ''} aria-label="${esc(t.label)} 아래로">▼</button>
          <button type="button" class="small danger" id="tpx-${i}" data-action="tp-exclude" data-id="${id}" aria-label="${esc(t.label)} 제외">제외</button>
        </span>
      </div>${panel}
    </li>`;
    })
    .join('');

  const rawSubjects = [...new Set(state.files.flatMap((f) => f.timepoints.flatMap((t) => t.subjects)))];
  const suggestions = suggestAliases(ds).filter((s) => !state.settings.aliases[s.from]);
  const aliasRows = rawSubjects
    .map((s, i) => `<tr><th scope="row">${esc(s)}</th><td><input id="alias-${i}" type="text" list="subject-list" value="${esc(state.settings.aliases[s] ?? '')}" placeholder="${esc(s)}" data-change="alias" data-subject="${esc(s)}" aria-label="${esc(s)}의 비교용 과목명"></td></tr>`)
    .join('');

  const studentRows = ds.students
    .map((s, i) => {
      const cells = ds.timepoints
        .map((t) => {
          const subj = [...(ds.byTp.get(t.id)?.values() ?? [])];
          const have = subj.filter((m) => (m.get(s.key)?.score ?? null) !== null).length;
          if (have === subj.length && have) return '✓';
          return have ? `<span class="miss" title="${subj.length - have}과목 결측">${have}/${subj.length}</span>` : '<span class="miss">–</span>';
        })
        .join('</td><td>');
      const flags = [s.nos.length > 1 ? '번호 불일치' : '', s.note ?? ''].filter(Boolean).join(', ');
      const merge = `<select id="merge-${i}" data-change="merge" data-key="${esc(s.key)}" aria-label="병합 대상">${opt('', '—', true)}${ds.students.filter((o) => o.key !== s.key).map((o) => opt(o.key, `${o.name} (${o.nos.join('/')}번)`, false)).join('')}</select>`;
      return `<tr><th scope="row">${esc(s.name)}${s.key !== s.name ? ` <span class="muted">(${esc(s.key)})</span>` : ''}</th><td>${esc(s.nos.join('/'))}</td><td>${cells}</td><td class="left">${esc(flags)}</td><td>${merge}</td></tr>`;
    })
    .join('');
  const merged = Object.entries(state.merges);

  const subjectsAll = [...new Set(ds.timepoints.flatMap((t) => t.subjects))];
  const sigmaRows = ds.timepoints
    .map((t, i) => `<tr><th scope="row">${esc(t.label)}</th>${subjectsAll.map((s, j) => (t.subjects.includes(s) ? `<td><input id="sg-${i}-${j}" class="num" type="number" step="0.1" min="0" value="${state.gradeSigma[`${t.id}|${s}`] ?? ''}" data-change="sigma" data-key="${esc(`${t.id}|${s}`)}" aria-label="${esc(`${t.label} ${s} 학년 표준편차`)}"></td>` : '<td class="muted">–</td>')).join('')}</tr>`)
    .join('');

  return `<div class="grid-2">
  <div class="${ds.issues.length ? 'alert' : 'ok'}"><h3>무결성 점검</h3>${ds.issues.length ? `<ul>${ds.issues.map((n) => `<li>${esc(n.fileName)}: ${esc(n.message)}</li>`).join('')}</ul>` : '<p>파일의 합계·평균·학급 총점과 재계산 값이 모두 일치합니다(허용오차 0.05).</p>'}</div>
  ${ds.notices.length ? `<div class="note"><h3>알림</h3><ul>${ds.notices.map((n) => `<li>${esc(n.fileName)}: ${esc(n.message)}</li>`).join('')}</ul></div>` : '<div></div>'}
</div>
<section class="card">
  <div class="card-head"><h2>시점 (${ds.timepoints.length}개)</h2><span class="actions"><button type="button" class="small" id="tp-open-all" data-action="tp-open-all">${state.openTps.length ? '모두 접기' : '모두 펼치기'}</button><button type="button" class="small" data-action="tp-reset">순서·정보 초기화</button></span></div>
  <p class="meta">▲▼로 순서를 바꾸고, 시점을 펼쳐 이름·유형·학년·학기·회차를 고칩니다. 필요 없는 시점(예: 원하지 않는 학년의 학기 성적)은 '제외'로 분석에서 뺍니다. 파일은 그대로 두며 언제든 다시 포함할 수 있습니다.</p>
  <ol class="tp-list" id="tp-list">${tpItems}</ol>
  ${ds.excluded.length ? `<div class="excluded"><span class="group-label">제외한 시점 (${ds.excluded.length})</span><ul>${ds.excluded.map((x, i) => `<li><span>${esc(x.label)} <span class="muted">· ${esc(x.fileName)}</span></span> <button type="button" class="small" id="tpin-${i}" data-action="tp-include" data-id="${esc(x.id)}">다시 포함</button></li>`).join('')}</ul></div>` : ''}
</section>
<div class="grid-2">
  <section class="card">
    <h2>과목 매핑</h2>
    <p class="meta">학년마다 이름이 다른 같은 과목(예: 사회 ↔ 역사)을 하나로 묶으려면 비교용 과목명을 입력하세요. 비우면 원래 이름을 씁니다.</p>
    ${suggestions.length ? `<ul class="suggest">${suggestions.map((s) => `<li>제안: <strong>${esc(s.from)}</strong> → <strong>${esc(s.to)}</strong> <span class="muted">(${esc(s.reason)})</span> <button type="button" class="small" data-action="apply-alias" data-from="${esc(s.from)}" data-to="${esc(s.to)}">적용</button></li>`).join('')}</ul>` : ''}
    <datalist id="subject-list">${rawSubjects.map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>
    <table class="data narrow"><thead><tr><th>원래 과목명</th><th>비교용 과목명</th></tr></thead><tbody>${aliasRows}</tbody></table>
  </section>
  <section class="card">
    <h2>학년 표준편차 (선택)</h2>
    <p class="meta">학교에서 받은 학년 표준편차가 있으면 입력하세요. 입력한 칸만 'z점수(학년)'으로 볼 수 있습니다. 저장되지 않습니다.</p>
    <div class="scroll"><table class="data form"><thead><tr><th>시점</th>${subjectsAll.map((s) => `<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>${sigmaRows}</tbody></table></div>
  </section>
</div>
<section class="card">
  <h2>학생 매칭 (${ds.students.length}명)</h2>
  <p class="meta">이름으로 파일 간 학생을 연결합니다. – 는 해당 시점 자료 없음(결측, 0점 아님). 같은 학생이 다른 이름으로 들어온 경우 '병합'으로 합치세요.</p>
  ${merged.length ? `<p>병합: ${merged.map(([a, b]) => `${esc(a)} → ${esc(b)} <button type="button" class="small" data-action="unmerge" data-key="${esc(a)}">취소</button>`).join(' · ')}</p>` : ''}
  <div class="scroll"><table class="data"><thead><tr><th>학생</th><th>번호</th>${ds.timepoints.map((t) => `<th>${esc(t.label)}</th>`).join('')}<th>비고</th><th>병합</th></tr></thead><tbody>${studentRows}</tbody></table></div>
</section>
<p><button type="button" class="button-primary" data-action="nav" data-view="analyze">다음: 대시보드 →</button></p>`;
}

function filters(m: Matrix): string {
  const ds = state.ds!;
  const grades = gradesOf(ds);
  const tps = ds.timepoints;
  const hasSigma = Object.keys(state.gradeSigma).length > 0;
  const field = (id: string, label: string, control: string) => `<div class="field"><label for="${id}">${label}</label>${control}</div>`;
  return `<section class="card filters" aria-label="분석 조건">
  <div class="filter-row">
    ${field('c-preset', '시나리오', `<select id="c-preset" data-change="preset">${(Object.keys(PRESET_LABEL) as Preset[]).map((p) => opt(p, PRESET_LABEL[p], state.preset === p)).join('')}</select>`)}
    ${state.preset === 'S1' || state.preset === 'S2' ? field('c-grade', '대상 학년', `<select id="c-grade" data-change="grade">${grades.map((g) => opt(String(g), `${g}학년`, state.grade === g)).join('')}</select>`) : ''}
    ${state.preset === 'S4' ? field('c-a', '시점 A', `<select id="c-a" data-change="pick-a">${tps.map((t) => opt(t.id, t.label, state.a === t.id)).join('')}</select>`) + field('c-b', '시점 B', `<select id="c-b" data-change="pick-b">${tps.map((t) => opt(t.id, t.label, state.b === t.id)).join('')}</select>`) : ''}
    ${field('c-student', '학생', `<select id="c-student" data-change="student">${ds.students.map((s) => opt(s.key, `${s.nos[0] ?? ''} ${s.name}`, state.student === s.key)).join('')}</select>`)}
    ${field('c-metric', '점수 기준', `<select id="c-metric" data-change="metric">${(Object.keys(METRIC_LABEL) as Metric[]).filter((k) => k !== 'zg' || hasSigma).map((k) => opt(k, METRIC_LABEL[k], state.metric === k)).join('')}</select>`)}
    ${field('c-focus', '중심 항목', `<select id="c-focus" data-change="focus">${m.items.map((i) => opt(i.id, i.label, state.focus === i.id)).join('')}</select>`)}
    <div class="field"><span class="group-label">단위</span><div class="chips">${chip('u-subject', 'value="subject" data-change="unit"', state.unit === 'subject', '과목', 'radio', 'unit')}${chip('u-group', 'value="group" data-change="unit"', state.unit === 'group', '교과군', 'radio', 'unit')}</div></div>
  </div>
  <div class="field"><span class="group-label">시점 (${state.tpIds.length}개 선택)</span><div class="chips">${tps.map((t, i) => chip(`tp-${i}`, `data-change="tp-toggle" data-id="${esc(t.id)}"`, state.tpIds.includes(t.id), `${esc(t.label)}${t.kind === 'semester' ? ' <span class="tag">학기</span>' : ''}`)).join('')}</div></div>
  <details class="more"><summary>추이 그래프에 표시할 과목</summary><div class="chips">${m.items.filter((i) => i.id !== AVG).map((i, k) => chip(`hid-${k}`, `data-change="hide-item" data-item="${esc(i.id)}"`, !state.hidden.includes(i.id), esc(i.label))).join('')}</div></details>
</section>`;
}

function viewAnalyze(): string {
  const c = ctx(true);
  if (!c) return '';
  const tabs: [Tab, string][] = [
    ['student', '학생 개인'],
    ['class', '학급 개관'],
    ['alerts', '주의 학생'],
    ['gap', '학기 성적↔고사'],
  ];
  let body = '';
  if (!state.tpIds.length) body = '<p class="alert">분석할 시점을 하나 이상 선택하세요.</p>';
  else if (state.tab === 'student') body = state.student ? studentSections(c, state.student) + footnotes(c) : '<p>학생을 선택하세요.</p>';
  else if (state.tab === 'class') body = classSections(c) + footnotes(c);
  else if (state.tab === 'alerts') body = alertsSection(c);
  else body = gapSection(c);
  return `${filters(c.m)}
  <div class="dash-toolbar"><div class="segmented" role="tablist">${tabs.map(([t, l]) => `<button type="button" role="tab" id="tab-${t}" class="tab${state.tab === t ? ' active' : ''}" aria-selected="${state.tab === t}" data-action="tab" data-tab="${t}">${l}</button>`).join('')}</div><span class="actions"><button type="button" class="button-ghost" id="charts-collapse" data-action="charts-all" data-mode="collapse">차트 모두 접기</button><button type="button" class="button-ghost" id="charts-expand" data-action="charts-all" data-mode="expand">차트 모두 펼치기</button></span></div>
  <div class="report dash-body" id="result-body">${body}</div>`;
}

function viewExport(): string {
  const ds = state.ds!;
  const scopes: [ExportScope, string][] = [
    ['student', `현재 학생 1명 (${state.student ? ds.students.find((s) => s.key === state.student)?.name ?? '' : '없음'})`],
    ['selected', '선택 학생'],
    ['all', '학급 전체 (학급 요약 + 학생마다 1장)'],
    ['class', '학급 요약만 (교사용)'],
  ];
  const c = ctx(false, state.anonymize);
  const previewKey = state.exportScope === 'selected' ? state.exportSelected[0] : state.student;
  const preview =
    c && previewKey && state.exportScope !== 'class'
      ? `<div class="report"><div class="parent-page">${parentReport(c, previewKey, new Date())}</div></div>`
      : state.exportScope === 'class'
        ? '<p class="meta">학급 요약은 교사용 여러 쪽 리포트입니다. 미리보기는 학생 리포트만 제공합니다.</p>'
        : '<p class="meta">미리볼 학생을 선택하세요.</p>';
  return `<div class="grid-export">
  <section class="card">
    <h2>내보내기 설정</h2>
    <div class="alert" role="note"><strong>개인정보 주의</strong> — ${esc(PRIVACY_NOTE)} 내보낸 파일은 이 컴퓨터에만 저장됩니다.</div>
    <p class="meta">학생 리포트는 학생·학부모 전달용 <strong>A4 1장</strong>입니다(점수 변화, 학년 평균 비교, 쉬운 설명, 선생님 의견 칸). 현재 분석 조건(시점 ${state.tpIds.length}개, ${state.unit === 'group' ? '교과군' : '과목'} 단위)으로 만듭니다.</p>
    <fieldset><legend>범위</legend>${scopes.map(([v, l]) => `<label class="check"><input id="scope-${v}" type="radio" name="scope" value="${v}" data-change="scope"${state.exportScope === v ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</fieldset>
    ${state.exportScope === 'selected' ? `<fieldset class="cols"><legend>학생 선택 (${state.exportSelected.length}명)</legend>${ds.students.map((s, i) => `<label class="check"><input id="sel-${i}" type="checkbox" data-change="export-pick" data-key="${esc(s.key)}"${state.exportSelected.includes(s.key) ? ' checked' : ''}> ${esc(s.name)}</label>`).join('')}</fieldset>` : ''}
    <p><label class="check"><input id="anon" type="checkbox" data-change="anonymize"${state.anonymize ? ' checked' : ''}> 익명화 (이름 → 학생A, 학생B…, 학번 숨김)</label></p>
    <p class="actions">
      <button type="button" id="btn-export-html" class="button-primary" data-action="export-html">HTML 파일로 저장</button>
      <button type="button" id="btn-print" class="button-primary" data-action="print">인쇄 / PDF로 저장</button>
    </p>
    <p class="meta">PDF: 인쇄 창에서 대상을 <strong>'PDF로 저장'</strong>으로 고르세요. 용지 A4, 배율 100%, 여백 기본값을 권장합니다.</p>
    ${state.message ? `<p class="ok" role="status">${esc(state.message)}</p>` : ''}
  </section>
  <section class="card">
    <h2>미리보기 <span class="meta">A4 1장</span></h2>
    <div class="a4-wrap"><div class="a4-preview" id="a4-preview">${preview}</div></div>
  </section>
</div>`;
}

function viewSettings(): string {
  const s = state.settings;
  const num = (id: string, field: keyof Settings, label: string, step = '0.1') =>
    `<label for="${id}">${label}</label><input id="${id}" class="num" type="number" step="${step}" value="${s[field] as number}" data-change="setting" data-field="${field}">`;
  return `<div class="grid-2">
  <section class="card">
    <h2>기준값</h2>
    <p class="meta">설정은 이 브라우저에 저장됩니다. 성적·이름은 저장하지 않습니다.</p>
    <div class="form-grid">
      ${num('st-trend', 'trendThreshold', '추세 판단 기준 |Δz| (상승/하락)')}
      ${num('st-drop', 'alertDrop', '주의: 최근 Δz 이하')}
      ${num('st-low', 'alertLowZ', '주의: 최근 과목 z 이하')}
      ${num('st-minn', 'minN', 'z 계산 최소 인원', '1')}
    </div>
    <h3>성취도 환산 기준 (만점 대비 %)</h3>
    <div class="form-grid">${['A', 'B', 'C', 'D'].map((l, i) => `<label for="cut-${i}">${l} 이상</label><input id="cut-${i}" class="num" type="number" step="1" value="${s.cutoffs[i]}" data-change="cutoff" data-index="${i}">`).join('')}</div>
  </section>
  <section class="card">
    <h2>교과군 (과목 묶음)</h2>
    <p class="meta">한 줄에 하나씩 '교과군: 과목, 과목' 형식으로 적습니다.</p>
    <textarea id="st-groups" rows="8" data-change="groups" aria-label="교과군">${esc(s.groups.map((g) => `${g.name}: ${g.subjects.join(', ')}`).join('\n'))}</textarea>
    <p><button type="button" class="button-ghost" data-action="reset-settings">기본값으로 되돌리기</button></p>
  </section>
</div>`;
}

export function render(): void {
  const active = document.activeElement as HTMLElement | null;
  const activeId = active?.id;
  const v: View = state.ds || state.view === 'settings' ? state.view : 'load';
  const nav = $('#nav');
  if (nav) nav.innerHTML = renderNav();
  const top = $('#topbar');
  if (top) top.innerHTML = renderTopbar(v);
  const app = $('#app')!;
  app.innerHTML = v === 'load' ? viewLoad() : v === 'check' ? viewCheck() : v === 'analyze' ? viewAnalyze() : v === 'export' ? viewExport() : viewSettings();
  if (activeId) document.getElementById(activeId)?.focus();
}

// ---------- 동작 ----------

async function loadFiles(list: FileList | File[]): Promise<void> {
  const errors: string[] = [];
  for (const file of [...list]) {
    if (!/\.xlsx$/i.test(file.name)) {
      errors.push(`${file.name}: xlsx 파일만 불러올 수 있습니다.`);
      continue;
    }
    try {
      const pf = parseGrid(readXlsx(new Uint8Array(await file.arrayBuffer())), file.name);
      state.files = [...state.files.filter((f) => f.fileName !== file.name), pf];
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `${file.name}: 읽을 수 없습니다.`);
    }
  }
  state.loadErrors = errors;
  rebuild(true);
  render();
}

function clearAll(): void {
  const settings = state.settings;
  state = initial();
  state.settings = settings;
  matrixCache = null;
  const input = $('#file-input') as HTMLInputElement | null;
  if (input) input.value = '';
  document.getElementById('print-root')!.innerHTML = '';
  render();
}

function reportCtx(): ViewCtx | null {
  return ctx(false, state.anonymize);
}

function reportStudents(): string[] {
  const ds = state.ds!;
  if (state.exportScope === 'student') return state.student ? [state.student] : [];
  if (state.exportScope === 'selected') return ds.students.map((s) => s.key).filter((k) => state.exportSelected.includes(k));
  if (state.exportScope === 'all') return ds.students.map((s) => s.key);
  return [];
}

export function buildReport(): string {
  const c = reportCtx();
  if (!c) return '';
  return buildReportBody(c, { scope: state.exportScope, students: reportStudents(), generatedAt: new Date() });
}

function exportHtml(): void {
  const body = buildReport();
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const title = `성적 추세 리포트 ${state.ds?.classLabel ?? ''} ${stamp}`.trim();
  const blob = new Blob([exportHtmlDocument(title, body)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `성적추세_${(state.ds?.classLabel ?? '학급').replace(/\s+/g, '')}_${state.exportScope}${state.anonymize ? '_익명' : ''}_${stamp}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  state.message = 'HTML 파일을 저장했습니다(브라우저의 다운로드 폴더).';
  render();
}

export function preparePrint(): void {
  const root = document.getElementById('print-root')!;
  root.innerHTML = buildReport();
  document.body.classList.add('print-mode');
}

function printReport(): void {
  preparePrint();
  window.print();
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('print-mode');
  document.getElementById('print-root')!.innerHTML = '';
});

function parseGroups(text: string): Settings['groups'] {
  return text
    .split('\n')
    .map((line) => {
      const [name, rest] = line.split(':');
      return { name: (name ?? '').trim(), subjects: (rest ?? '').split(/[,，]/).map((x) => x.trim()).filter(Boolean) };
    })
    .filter((g) => g.name && g.subjects.length);
}

function onAction(el: HTMLElement): void {
  const d = el.dataset;
  switch (d.action) {
    case 'nav':
      state.view = d.view as View;
      state.message = '';
      break;
    case 'tab':
      state.tab = d.tab as Tab;
      break;
    case 'remove-file':
      state.files = state.files.filter((f) => f.fileName !== d.file);
      rebuild(true);
      break;
    case 'tp-move': {
      const ids = state.ds!.timepoints.map((t) => t.id);
      const i = ids.indexOf(d.id!);
      const j = i + Number(d.dir);
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      state.tpOrder = ids;
      rebuild();
      break;
    }
    case 'tp-reset':
      state.tpOrder = [];
      state.tpOverrides = {};
      state.excludedTps = [];
      rebuild(true);
      break;
    case 'tp-exclude':
      state.excludedTps = [...new Set([...state.excludedTps, d.id!])];
      rebuild();
      break;
    case 'chart-toggle':
      state.collapsedCharts = state.collapsedCharts.includes(d.key!) ? state.collapsedCharts.filter((k) => k !== d.key) : [...state.collapsedCharts, d.key!];
      break;
    case 'charts-all': {
      const keys = [...document.querySelectorAll<HTMLElement>('#result-body [data-chart]')].map((el) => el.dataset.chart!);
      state.collapsedCharts = d.mode === 'collapse' ? [...new Set([...state.collapsedCharts, ...keys])] : state.collapsedCharts.filter((k) => !keys.includes(k));
      break;
    }
    case 'tp-open':
      state.openTps = state.openTps.includes(d.id!) ? state.openTps.filter((x) => x !== d.id) : [...state.openTps, d.id!];
      break;
    case 'tp-open-all':
      state.openTps = state.openTps.length ? [] : state.ds!.timepoints.map((t) => t.id);
      break;
    case 'tp-include':
      state.excludedTps = state.excludedTps.filter((x) => x !== d.id);
      rebuild();
      break;
    case 'apply-alias':
      state.settings.aliases = { ...state.settings.aliases, [d.from!]: d.to! };
      saveSettings(state.settings);
      rebuild();
      break;
    case 'unmerge': {
      const { [d.key!]: _, ...rest } = state.merges;
      state.merges = rest;
      rebuild();
      break;
    }
    case 'export-html':
      exportHtml();
      return;
    case 'print':
      printReport();
      return;
    case 'reset-settings':
      state.settings = structuredClone(DEFAULT_SETTINGS);
      saveSettings(state.settings);
      rebuild();
      break;
    default:
      return;
  }
  render();
}

function onChange(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  const d = el.dataset;
  const v = el.value;
  const checked = (el as HTMLInputElement).checked;
  const ov = (id: string) => (state.tpOverrides[id] = { ...(state.tpOverrides[id] ?? {}) });
  switch (d.change) {
    case 'tp-label':
      ov(d.id!).label = v.trim() || undefined;
      rebuild();
      break;
    case 'tp-kind':
      ov(d.id!).kind = v as TpKind;
      rebuild();
      break;
    case 'tp-meta': {
      // 시점 id가 파일 메타에서 만들어지므로 원래 id 기준으로 덮어쓴다.
      ov(d.id!)[d.field as 'grade' | 'semester' | 'round'] = v === '' ? null : Number(v);
      rebuild();
      break;
    }
    case 'alias': {
      const aliases = { ...state.settings.aliases };
      if (v.trim() && v.trim() !== d.subject) aliases[d.subject!] = v.trim();
      else delete aliases[d.subject!];
      state.settings.aliases = aliases;
      saveSettings(state.settings);
      rebuild();
      break;
    }
    case 'merge':
      if (v) state.merges = { ...state.merges, [d.key!]: v };
      rebuild();
      break;
    case 'sigma': {
      const n = Number(v);
      if (v === '' || !(n > 0)) delete state.gradeSigma[d.key!];
      else state.gradeSigma[d.key!] = n;
      state.gradeSigma = { ...state.gradeSigma };
      if (!Object.keys(state.gradeSigma).length && state.metric === 'zg') state.metric = 'z';
      break;
    }
    case 'preset':
      state.preset = v as Preset;
      applyPreset();
      break;
    case 'grade':
      state.grade = Number(v);
      applyPreset();
      break;
    case 'pick-a':
      state.a = v;
      applyPreset();
      break;
    case 'pick-b':
      state.b = v;
      applyPreset();
      break;
    case 'tp-toggle': {
      const set = new Set(state.tpIds);
      if (checked) set.add(d.id!);
      else set.delete(d.id!);
      state.tpIds = state.ds!.timepoints.filter((t) => set.has(t.id)).map((t) => t.id);
      state.preset = 'custom';
      break;
    }
    case 'unit':
      state.unit = v as Unit;
      state.focus = AVG;
      state.hidden = [];
      break;
    case 'metric':
      state.metric = v as Metric;
      break;
    case 'focus':
      state.focus = v;
      break;
    case 'student':
      state.student = v;
      break;
    case 'hide-item':
      state.hidden = checked ? state.hidden.filter((x) => x !== d.item) : [...state.hidden, d.item!];
      break;
    case 'scope':
      state.exportScope = v as ExportScope;
      state.message = '';
      break;
    case 'export-pick':
      state.exportSelected = checked ? [...state.exportSelected, d.key!] : state.exportSelected.filter((k) => k !== d.key);
      break;
    case 'anonymize':
      state.anonymize = checked;
      break;
    case 'setting': {
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      (state.settings as unknown as Record<string, number>)[d.field!] = n;
      saveSettings(state.settings);
      break;
    }
    case 'cutoff': {
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      state.settings.cutoffs = state.settings.cutoffs.map((c, i) => (i === Number(d.index) ? n : c)) as Settings['cutoffs'];
      saveSettings(state.settings);
      break;
    }
    case 'groups':
      state.settings.groups = parseGroups(v);
      saveSettings(state.settings);
      break;
    default:
      return;
  }
  render();
}

export function start(): void {
  document.addEventListener('click', (e) => {
    const t = e.target as Element;
    const stu = t.closest<HTMLElement | SVGElement>('[data-student]');
    if (stu && t.closest('#app')) {
      state.student = (stu as HTMLElement).dataset.student ?? stu.getAttribute('data-student');
      state.tab = 'student';
      state.view = 'analyze';
      render();
      window.scrollTo(0, 0);
      return;
    }
    const a = t.closest<HTMLElement>('[data-action]');
    if (a && !(a as HTMLButtonElement).disabled) onAction(a);
  });
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'file-input') {
      const files = (t as HTMLInputElement).files;
      if (files?.length) void loadFiles(files);
      return;
    }
    if (t.dataset?.change) onChange(t as HTMLInputElement);
  });
  document.addEventListener('dragover', (e) => {
    if ((e.target as Element).closest?.('#drop')) {
      e.preventDefault();
      $('#drop')?.classList.add('over');
    }
  });
  document.addEventListener('dragleave', () => $('#drop')?.classList.remove('over'));
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    $('#drop')?.classList.remove('over');
    if ((e.target as Element).closest?.('#drop') && e.dataTransfer?.files.length) void loadFiles(e.dataTransfer.files);
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.id === 'drop') {
      e.preventDefault();
      ($('#file-input') as HTMLInputElement | null)?.click();
    }
  });
  $('#clear-all')?.addEventListener('click', () => {
    if (!state.files.length || window.confirm('불러온 성적 데이터와 분석 결과를 모두 지웁니다. 계속할까요?')) clearAll();
  });
  render();
}

// E2E·성능 점검용 훅(데이터를 밖으로 보내지 않음)
export const debugHooks = { preparePrint, render, setPreset: (p: Preset) => { state.preset = p; applyPreset(); render(); } };
