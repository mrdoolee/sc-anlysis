// 화면과 리포트가 함께 쓰는 HTML 섹션 빌더(문자열). 인라인 style 속성을 쓰지 않는다.
import { AVG, METRIC_LABEL, alerts, metricValue, semesterGap, studentTrend, trendCounts, type Matrix, type Metric } from '../core/analysis.ts';
import type { Dataset } from '../core/dataset.ts';
import { KIND_LABEL, defaultLabel } from '../core/dataset.ts';
import { interpretParent, interpretStudent } from '../core/interpret.ts';
import type { Settings } from '../core/settings.ts';
import { fmt, fmtSigned } from '../core/stats.ts';
import { barChart, boxPlot, esc, groupedBarChart, heatmap, lineChart, radarChart, scatterChart } from '../charts/svg.ts';

export interface ViewCtx {
  ds: Dataset;
  m: Matrix;
  settings: Settings;
  metric: Metric;
  focus: string;
  hidden: Set<string>;
  interactive: boolean;
  anonymize: boolean;
  nameOf: (key: string) => string;
  /** 대시보드에서 펼친 차트 키(기본은 모두 접힘) */
  expanded?: Set<string>;
  /** 대시보드에서 석차·백분위를 보일지(기본 숨김, 상담 중 노출 방지) */
  showRank?: boolean;
  /** 학급 개관 학생별 표 정렬 */
  sort?: { col: string; dir: 'asc' | 'desc' };
}

export const tpLabelOf = (ds: Dataset) => (id: string) => ds.timepoints.find((t) => t.id === id)?.label ?? id;

export function anonymizer(ds: Dataset, on: boolean): (key: string) => string {
  const idx = new Map(ds.students.map((s, i) => [s.key, i]));
  const letters = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letters(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
  return (key) => {
    if (!on) return ds.students.find((s) => s.key === key)?.name ?? key;
    const i = idx.get(key);
    return i === undefined ? '학생' : `학생${letters(i)}`;
  };
}

function domain(metric: Metric, values: (number | null)[], fullMark = 100): [number, number] {
  if (metric === 'raw') return [0, fullMark];
  const m = Math.max(2.5, ...values.filter((v): v is number => v !== null).map((v) => Math.ceil(Math.abs(metric === 't' ? (v - 50) / 10 : v))));
  return metric === 't' ? [50 - 10 * m, 50 + 10 * m] : [-m, m];
}

const fullMarkOf = (m: Matrix, item: string) => Math.max(100, ...m.tpIds.map((tp) => m.stat(item, tp)?.fullMark ?? 100));

function figure(svg: string, table = ''): string {
  return `<figure class="chart">${svg}${table ? `<details class="data-table"><summary>데이터 표 보기</summary>${table}</details>` : ''}</figure>`;
}

/**
 * 대시보드(interactive)에서는 차트마다 한 줄 머리글(제목 + 접기/펼치기)이 있는 전체 폭 상자로,
 * 리포트·인쇄에서는 기존 그림 카드로 그린다. key는 접힘 상태를 기억하는 고정 이름.
 */
function figureFor(ctx: ViewCtx) {
  return (key: string, svg: string, tbl = ''): string => {
    if (!ctx.interactive) return figure(svg, tbl);
    const title = /aria-label="([^"]*)"/.exec(svg)?.[1] ?? '';
    const open = ctx.expanded?.has(key) ?? false;
    const body = open ? `<div class="chart-body" id="cbb-${key}">${svg}${tbl ? `<details class="data-table"><summary>데이터 표 보기</summary>${tbl}</details>` : ''}</div>` : '';
    return `<section class="chart-box${open ? '' : ' collapsed'}" data-chart="${key}"><div class="chart-head"><h3>${title}</h3><button type="button" class="small chart-toggle" id="cb-${key}" data-action="chart-toggle" data-key="${key}" aria-expanded="${open}"${open ? ` aria-controls="cbb-${key}"` : ''}>${open ? '접기 ▴' : '펼치기 ▾'}</button></div>${body}</section>`;
  };
}

function table(head: string[], rows: string[][], cls = 'data'): string {
  return `<table class="${cls}"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</tbody></table>`;
}

const studentLink = (ctx: ViewCtx, key: string) =>
  ctx.interactive ? `<button type="button" class="link" data-student="${esc(key)}">${esc(ctx.nameOf(key))}</button>` : esc(ctx.nameOf(key));

/** 늘 보이는 차트. 대시보드에서는 누르면 모달로 크게 본다(원본은 <template>에 보관). */
function pinned(ctx: ViewCtx, list: [string, string, string][]): string {
  if (!ctx.interactive) return `<div class="charts">${list.map(([, svg, tbl]) => figure(svg, tbl)).join('')}</div>`;
  return `<div class="pinned">${list
    .map(([key, svg, tbl]) => {
      const title = /aria-label="([^"]*)"/.exec(svg)?.[1] ?? '';
      return `<div class="pin-card"><button type="button" class="pin-zoom" id="zoom-${key}" data-action="chart-zoom" data-key="${key}" aria-label="${title} 크게 보기"><span class="pin-head"><span class="pin-title">${title}</span><span class="pin-hint">크게 보기 ⤢</span></span>${svg}</button><template id="zoom-src-${key}">${tbl ? `<details class="data-table" open><summary>데이터 표</summary>${tbl}</details>` : ''}</template></div>`;
    })
    .join('')}</div>`;
}

export function selectionSummary(ctx: ViewCtx): string {
  const lab = tpLabelOf(ctx.ds);
  return `<p class="meta">분석 구간: ${ctx.m.tpIds.map((id) => esc(lab(id))).join(' → ') || '없음'} · 단위: ${ctx.m.unit === 'group' ? '교과군' : '과목'} · 기준: ${esc(METRIC_LABEL[ctx.metric])}</p>`;
}

export function footnotes(ctx: ViewCtx): string {
  const notes = [
    '원점수가 기본 기준입니다. z = (점수 − 학급 평균) / 학급 표준편차(모표준편차), T = 50 + 10z.',
    `학년 표준편차가 파일에 없으므로 z·T는 학급 기준입니다. 학년 비교는 '학년평균 대비 편차 = 점수 − 학년평균'으로 봅니다. 응시 인원이 ${ctx.settings.minN}명 미만이거나 표준편차가 0이면 z를 계산하지 않습니다.`,
    '공통 과목 평균은 선택한 모든 시점에 있는 과목만 평균한 값이며, 그중 한 과목이라도 결측이면 그 시점 평균도 결측입니다.',
    `추세 라벨: 첫 시점 대비 마지막 시점 Δz ≥ +${ctx.settings.trendThreshold} 상승, ≤ −${ctx.settings.trendThreshold} 하락, 그 외 유지. 석차는 동점 동순위, 백분위 = (낮은 학생 수 + 0.5 × 동점 수)/n × 100.`,
    `성취도 환산(참고용): A ≥ ${ctx.settings.cutoffs[0]}, B ≥ ${ctx.settings.cutoffs[1]}, C ≥ ${ctx.settings.cutoffs[2]}, D ≥ ${ctx.settings.cutoffs[3]}, E 미만(만점 대비 %).`,
  ];
  if (ctx.m.unit === 'group') notes.push('교과군 값은 해당 시점에 있는 묶음 과목의 평균이므로 시점마다 구성 과목이 다를 수 있습니다.');
  if (ctx.m.mixedKinds) notes.push('학기 성적(수행평가 등 포함 가능)과 지필고사 점수가 함께 있습니다. 측정 기준이 다를 수 있으므로 원점수 차이보다 학급 내 상대 위치(z)를 함께 보세요.');
  return `<aside class="footnotes"><h4>기준·수식·한계</h4><ol>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ol></aside>`;
}

export const PRIVACY_NOTE = '이 문서에는 학생 개인정보(이름·성적)가 포함되어 있습니다. 승인된 용도로만 사용하고, 외부 공유·온라인 업로드를 하지 마세요.';

function kpi(label: string, value: string, sub = ''): string {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}

export function studentSections(ctx: ViewCtx, stu: string): string {
  const fig = figureFor(ctx);
  const { m, ds, settings, metric } = ctx;
  const lab = tpLabelOf(ds);
  const xLabels = m.tpIds.map(lab);
  const st = ds.students.find((s) => s.key === stu);
  const items = m.items.filter((i) => i.id !== AVG);
  const avgTrend = studentTrend(m, AVG, stu, 'raw', settings);
  const lastIdx = [...m.tpIds.keys()].reverse().find((i) => avgTrend.values[i] !== null);
  const lastTp = lastIdx === undefined ? null : m.tpIds[lastIdx];
  const lastCell = lastTp ? m.cell(AVG, lastTp, stu) : undefined;
  const al = alerts(m, settings, lab).find((a) => a.student === stu);
  let html = `<header class="student-head"><h2>${esc(ctx.nameOf(stu))}</h2><p class="meta">${esc(ds.classLabel ?? '')}${st?.nos.length ? ` · ${st.nos.join('/')}번` : ''}${st?.note ? ` · ${esc(st.note)}` : ''}</p>${selectionSummary(ctx)}</header>`;

  const v = avgTrend.values.filter((x): x is number => x !== null);
  const rankVisible = !ctx.interactive || ctx.showRank === true;
  const rankText = lastCell?.rank ? `${lastCell.rank}/${m.stat(AVG, lastTp!)?.n ?? '–'}위` : '–';
  const prText = lastCell?.pr !== null && lastCell?.pr !== undefined ? `백분위 ${fmt(lastCell.pr, 0)}` : '';
  const rankKpi = rankVisible
    ? kpi('최근 학급 석차', rankText, `${prText}${ctx.interactive ? ' <button type="button" class="small" id="rank-toggle" data-action="rank-toggle">숨기기</button>' : ''}`)
    : `<div class="kpi rank-hidden"><div class="kpi-label">최근 학급 석차</div><button type="button" class="button-primary rank-show" id="rank-toggle" data-action="rank-toggle">석차 보기</button><div class="kpi-sub">상담 중 노출을 막기 위해 가려 두었습니다</div></div>`;
  html += `<div class="kpis">${kpi('공통 과목 평균', v.length ? `${fmt(v[0])} → ${fmt(v.at(-1))}` : '–', v.length >= 2 ? `Δ ${fmtSigned(avgTrend.delta)}점` : '')}${kpi('학급 내 위치(z)', avgTrend.deltaZ !== null ? fmtSigned(avgTrend.deltaZ, 2) : '–', `추세: <strong class="trend trend-${avgTrend.label === '상승' ? 'up' : avgTrend.label === '하락' ? 'down' : 'flat'}">${avgTrend.label}</strong>`)}${rankKpi}${kpi('주의 신호', al ? `${al.reasons.length}건` : '없음', al ? al.reasons.map(esc).join('<br>') : '')}</div>`;

  // 늘 보이는 차트: 과목별 추이(원점수)·표준화 추이(z)
  const shown = items.filter((i) => !ctx.hidden.has(i.id));
  const rawSeries = shown.map((i) => ({ name: i.label, values: m.tpIds.map((tp) => m.cell(i.id, tp, stu)?.raw ?? null), style: items.indexOf(i) }));
  const zSeries = shown.map((i) => ({ name: i.label, values: m.tpIds.map((tp) => m.cell(i.id, tp, stu)?.z ?? null), style: items.indexOf(i) }));
  const [zl, zh] = domain('z', zSeries.flatMap((x) => x.values));
  html += pinned(ctx, [
    [
      'stu-lines',
      lineChart({ title: '과목별 추이 (원점수)', xLabels, series: rawSeries, yMin: 0, yMax: Math.max(100, ...shown.map((i) => fullMarkOf(m, i.id))) }),
      table(['과목', ...xLabels.map(esc)], rawSeries.map((x) => [esc(x.name), ...x.values.map((y) => fmt(y))])),
    ],
    [
      'stu-z',
      lineChart({ title: '표준화 추이 (z점수, 학급 기준)', xLabels, series: zSeries, yMin: zl, yMax: zh, band: [-1, 1], hlines: [{ y: 0, label: '학급 평균' }] }),
      table(['과목', ...xLabels.map(esc)], zSeries.map((x) => [esc(x.name), ...x.values.map((y) => fmt(y, 2))])),
    ],
  ]);

  const sentences = interpretStudent(m, stu, settings, lab, { hideRank: !rankVisible });
  html += `<section class="interpret"><h3>해석</h3><ul>${sentences.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></section>`;

  html += `<div class="charts">`;
  // 2) 선택 항목 vs 학급·학년 평균(원점수)
  const focus = m.items.find((i) => i.id === ctx.focus) ?? m.items.find((i) => i.id === AVG)!;
  const fv = m.tpIds.map((tp) => m.cell(focus.id, tp, stu)?.raw ?? null);
  const cm = m.tpIds.map((tp) => m.stat(focus.id, tp)?.mean ?? null);
  const gm = m.tpIds.map((tp) => m.stat(focus.id, tp)?.gradeMean ?? null);
  html += fig('stu-focus', 
    lineChart({
      title: `${focus.label}: 학생 vs 학급·학년 평균 (원점수)`, xLabels, yMin: 0, yMax: fullMarkOf(m, focus.id),
      series: [{ name: '학생', values: fv, style: 0 }, { name: '학급 평균', values: cm, reference: true }, { name: '학년 평균', values: gm, style: 5 }],
    }),
    table(['구분', ...xLabels.map(esc)], [['학생', ...fv.map((x) => fmt(x))], ['학급 평균', ...cm.map((x) => fmt(x))], ['학년 평균', ...gm.map((x) => fmt(x))], ['학년평균 대비', ...m.tpIds.map((tp) => fmtSigned(m.cell(focus.id, tp, stu)?.dev))]]),
  );

  // 4) 레이더(공통 과목, 최대 3시점)
  const radarTps = m.tpIds.length <= 3 ? m.tpIds : [m.tpIds[0], m.tpIds[Math.floor(m.tpIds.length / 2)], m.tpIds.at(-1)!];
  const axes = items.filter((i) => radarTps.every((tp) => m.stat(i.id, tp)?.n));
  const rm: Metric = metric === 'raw' ? 'raw' : 't';
  html += fig('stu-radar', 
    radarChart({
      title: `과목 프로파일 (${rm === 'raw' ? '원점수' : 'T점수'})`, axes: axes.map((a) => a.label), min: rm === 'raw' ? 0 : 20, max: rm === 'raw' ? 100 : 80,
      series: radarTps.map((tp, k) => ({ name: lab(tp), values: axes.map((a) => metricValue(m.cell(a.id, tp, stu), rm)), style: k })),
    }),
  );

  // 5) 전회 대비 변화
  if (m.tpIds.length >= 2) {
    const a = m.tpIds.at(-2)!;
    const b = m.tpIds.at(-1)!;
    const dv = items.map((i) => {
      const x = metricValue(m.cell(i.id, a, stu), metric);
      const y = metricValue(m.cell(i.id, b, stu), metric);
      return x === null || y === null ? null : y - x;
    });
    html += fig('stu-delta', barChart({ title: `전회 대비 변화: ${lab(a)} → ${lab(b)} (${METRIC_LABEL[metric]})`, labels: items.map((i) => i.label), values: dv, signed: true, digits: metric === 'raw' || metric === 't' ? 1 : 2 }));
  }

  // 6) 과목 × 시점 z 프로파일
  html += fig('stu-heat', heatmap({ title: '과목별 학급 내 위치 (z)', rows: items.map((i) => i.label), cols: xLabels, values: items.map((i) => m.tpIds.map((tp) => m.cell(i.id, tp, stu)?.z ?? null)), digits: 2 }));

  // 7) 석차·백분위 추이(석차 보기를 켠 경우만)
  const prs = m.tpIds.map((tp) => m.cell(AVG, tp, stu)?.pr ?? null);
  if (rankVisible) html += fig('stu-pr', 
    lineChart({ title: '공통 과목 평균 학급 백분위 추이 (높을수록 상위)', xLabels, series: [{ name: '백분위', values: prs, style: 2 }], yMin: 0, yMax: 100 }),
    table(['구분', ...xLabels.map(esc)], [['석차', ...m.tpIds.map((tp) => { const c = m.cell(AVG, tp, stu); return c?.rank ? `${c.rank}/${m.stat(AVG, tp)?.n}` : '–'; })], ['백분위', ...prs.map((x) => fmt(x, 0))]]),
  );
  html += `</div>`;

  // 8) 상세 표
  const rows = m.items.map((i) => [
    esc(i.label),
    ...m.tpIds.map((tp) => {
      const c = m.cell(i.id, tp, stu);
      if (!c) return '<span class="muted">없음</span>';
      const n = m.stat(i.id, tp)?.n;
      return `<strong>${fmt(c.raw)}</strong><span class="sub">z ${fmtSigned(c.z, 2)} · T ${fmt(c.t)}${rankVisible ? ` · ${c.rank ?? '–'}/${n}위` : ''} · 학년 ${fmtSigned(c.dev)} · 성취 ${esc(c.achFile ?? c.achCalc ?? '–')}${c.achFile ? '' : '(환산)'}</span>`;
    }),
  ]);
  html += `<section><h3>과목별 상세</h3>${table(['과목', ...xLabels.map(esc)], rows, 'data detail')}</section>`;

  return html;
}

export function classSections(ctx: ViewCtx): string {
  const fig = figureFor(ctx);
  const { m, ds, settings, metric } = ctx;
  const lab = tpLabelOf(ds);
  const xLabels = m.tpIds.map(lab);
  const focus = m.items.find((i) => i.id === ctx.focus) ?? m.items.find((i) => i.id === AVG)!;
  const counts = trendCounts(m, focus.id, settings);
  let html = `<header><h2>${esc(ds.classLabel ?? '학급')} 학급 개관</h2>${selectionSummary(ctx)}<p class="meta">중심 항목: ${esc(focus.label)} · 학생 ${m.students.length}명 · 공통 과목: ${esc(m.common.join(', ') || '없음')}</p></header>`;
  html += `<div class="kpis">${kpi('학생 수', String(m.students.length))}${kpi('상승', `${counts.상승}명`)}${kpi('유지', `${counts.유지}명`)}${kpi('하락', `${counts.하락}명`, counts['판단 불가'] ? `판단 불가 ${counts['판단 불가']}명` : '')}</div>`;
  html += `<div class="charts">`;
  html += fig('cls-trend', barChart({ title: `${focus.label} 추세 분포 (학생 수)`, labels: ['상승', '유지', '하락', '판단 불가'], values: [counts.상승, counts.유지, counts.하락, counts['판단 불가']], digits: 0 }));

  const means = m.items.map((i, k) => ({ name: i.label, values: m.tpIds.map((tp) => m.stat(i.id, tp)?.mean ?? null), style: i.id === AVG ? 6 : k }));
  html += fig('cls-means', 
    lineChart({ title: '학급 평균 추이 (원점수)', xLabels, series: [...means, { name: `${focus.label} 학년 평균`, values: m.tpIds.map((tp) => m.stat(focus.id, tp)?.gradeMean ?? null), reference: true }], yMin: 0, yMax: Math.max(...m.items.map((i) => fullMarkOf(m, i.id))) }),
    table(['항목', ...xLabels.map(esc)], m.items.map((i) => [esc(i.label), ...m.tpIds.map((tp) => { const s = m.stat(i.id, tp); return s?.n ? `${fmt(s.mean)} (σ ${fmt(s.sd)}, n=${s.n}, 학년 ${fmt(s.gradeMean)})` : '–'; })])),
  );

  const boxes = m.tpIds.map((tp) => {
    const s = m.stat(focus.id, tp);
    return { min: s?.min ?? null, q1: s?.q1 ?? null, median: s?.median ?? null, q3: s?.q3 ?? null, max: s?.max ?? null, mean: s?.mean ?? null, n: s?.n ?? 0 };
  });
  html += fig('cls-box', boxPlot({ title: `${focus.label} 분포 (원점수)`, labels: xLabels, boxes, reference: m.tpIds.map((tp) => m.stat(focus.id, tp)?.gradeMean ?? null), yMin: 0, yMax: fullMarkOf(m, focus.id) }));

  const lastTp = m.tpIds.at(-1);
  if (lastTp) {
    const fm = fullMarkOf(m, focus.id);
    const vals = m.students.map((s) => m.cell(focus.id, lastTp, s)?.raw ?? null).filter((x): x is number => x !== null);
    const bins = Array.from({ length: 10 }, (_, i) => vals.filter((v) => (i === 9 ? v >= (fm * i) / 10 : v >= (fm * i) / 10 && v < (fm * (i + 1)) / 10)).length);
    html += fig('cls-hist', barChart({ title: `${focus.label} 점수 분포: ${lab(lastTp)} (학생 수)`, labels: bins.map((_, i) => `${(fm * i) / 10}~`), values: bins, digits: 0 }));
  }

  const keys = m.students.filter((s) => m.tpIds.some((tp) => m.cell(focus.id, tp, s)));
  html += fig('cls-heat', heatmap({ title: `학생 × 시점 학급 내 위치 (z, ${focus.label})`, rows: keys.map(ctx.nameOf), rowKeys: ctx.interactive ? keys : undefined, cols: xLabels, values: keys.map((s) => m.tpIds.map((tp) => m.cell(focus.id, tp, s)?.z ?? null)), digits: 2 }));

  if (m.tpIds.length >= 2) {
    const a = m.tpIds[0];
    const b = m.tpIds.at(-1)!;
    const sm: Metric = metric === 'zg' ? 'z' : metric;
    const pts = m.students
      .map((s) => ({ x: metricValue(m.cell(focus.id, a, s), sm), y: metricValue(m.cell(focus.id, b, s), sm), label: ctx.nameOf(s), key: ctx.interactive ? s : undefined }))
      .filter((p): p is { x: number; y: number; label: string; key: string | undefined } => p.x !== null && p.y !== null);
    const [lo, hi] = domain(sm, pts.flatMap((p) => [p.x, p.y]), fullMarkOf(m, focus.id));
    html += fig('cls-scatter', scatterChart({ title: `${focus.label}: ${lab(a)} vs ${lab(b)} (${METRIC_LABEL[sm]})`, points: pts, xLabel: lab(a), yLabel: lab(b), min: lo, max: hi }));
  }
  html += `</div>`;

  // 학생별 표: 머리글을 눌러 정렬(대시보드). 결측은 항상 맨 아래.
  const d = metric === 'raw' || metric === 't' ? 1 : 2;
  const last = m.tpIds.at(-1);
  const TREND_RANK: Record<string, number> = { 상승: 3, 유지: 2, 하락: 1, '판단 불가': 0 };
  const recs = m.students.map((s, idx) => {
    const t = studentTrend(m, focus.id, s, metric, settings);
    const pr = last ? (m.cell(focus.id, last, s)?.pr ?? null) : null;
    const keys: Record<string, number | null> = { name: idx, delta: t.delta, dz: t.deltaZ, trend: t.label === '판단 불가' ? null : TREND_RANK[t.label] * 100 + (t.deltaZ ?? 0), pr };
    m.tpIds.forEach((tp, i) => (keys[`tp:${tp}`] = t.values[i]));
    const cells = [
      studentLink(ctx, s),
      ...t.values.map((x) => fmt(x, d)),
      fmtSigned(t.delta, d),
      fmtSigned(t.deltaZ, 2),
      `<span class="trend trend-${t.label === '상승' ? 'up' : t.label === '하락' ? 'down' : 'flat'}">${t.label}</span>`,
      fmt(pr, 0),
    ];
    return { keys, cells };
  });
  const sort = ctx.sort ?? { col: 'name', dir: 'asc' as const };
  const sign = sort.dir === 'asc' ? 1 : -1;
  recs.sort((a, b) => {
    const x = a.keys[sort.col] ?? null;
    const y = b.keys[sort.col] ?? null;
    if (x === null && y === null) return (a.keys.name as number) - (b.keys.name as number);
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * sign || (a.keys.name as number) - (b.keys.name as number);
  });
  const cols: [string, string][] = [['name', '학생'], ...m.tpIds.map((tp, i): [string, string] => [`tp:${tp}`, esc(xLabels[i])]), ['delta', 'Δ'], ['dz', 'Δz'], ['trend', '추세'], ['pr', '최근 백분위']];
  const head = cols
    .map(([key, label], i) => {
      if (!ctx.interactive) return `<th scope="col">${label}</th>`;
      const on = sort.col === key;
      const aria = on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" aria-sort="${aria}"><button type="button" class="sort-btn${on ? ' on' : ''}" id="sort-${i}" data-action="class-sort" data-col="${esc(key)}">${label}<span class="sort-ind" aria-hidden="true">${on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
    })
    .join('');
  const body = recs.map((r) => `<tr>${r.cells.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('');
  html += `<section><h3>학생별 ${esc(focus.label)} (${esc(METRIC_LABEL[metric])})${ctx.interactive ? ' <span class="meta">머리글을 누르면 정렬됩니다</span>' : ''}</h3><div class="scroll"><table class="data sortable" id="class-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  return html;
}

export function alertsSection(ctx: ViewCtx): string {
  const lab = tpLabelOf(ctx.ds);
  const list = alerts(ctx.m, ctx.settings, lab);
  const s = ctx.settings;
  let html = `<header><h2>주의 학생</h2>${selectionSummary(ctx)}<p class="meta">기준: 최근 공통 과목 평균 Δz ≤ ${s.alertDrop}, 2회 연속 하락, 또는 마지막 시점 과목 z ≤ ${s.alertLowZ} (설정에서 변경)</p></header>`;
  if (!list.length) return `${html}<p>기준에 해당하는 학생이 없습니다.</p>`;
  html += table(['학생', '사유'], list.map((a) => [studentLink(ctx, a.student), `<ul class="reasons">${a.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`]));
  return html;
}

export function gapSection(ctx: ViewCtx, stu?: string): string {
  const fig = figureFor(ctx);
  const gaps = semesterGap(ctx.ds);
  let html = `<section class="gap"><h3>학기 성적 ↔ 고사 격차${stu ? '' : ' (학급)'}</h3><p class="meta">격차 = 학기 성적 − 같은 학기 고사 평균(만점 대비 %). 학기 성적에는 수행평가 등이 포함될 수 있어 참고 지표입니다.</p>`;
  if (!gaps.length) return `${html}<p>같은 학년·학기의 학기 성적과 고사가 함께 있을 때 표시합니다.</p></section>`;
  for (const [gi, g] of gaps.entries()) {
    const title = `${g.semTp.label} vs ${g.examTps.map((e) => e.label).join('·')}`;
    if (stu) {
      const rows = g.rows.map((r) => {
        const v = r.perStudent.get(stu);
        return [esc(r.subject), fmt(v?.sem), fmt(v?.exam), fmtSigned(v?.gap), fmtSigned(r.classGap)];
      });
      html += `<h4>${esc(title)}</h4>${table(['과목', '학기 성적', '고사 평균', '격차', '학급 평균 격차'], rows)}`;
    } else {
      html += fig(`gap-${gi}`, barChart({ title: `학급 평균 격차: ${title}`, labels: g.rows.map((r) => r.subject), values: g.rows.map((r) => r.classGap), signed: true }));
      html += table(['과목', 'n', '학급 평균 격차'], g.rows.map((r) => [esc(r.subject), String(r.n), fmtSigned(r.classGap)]));
    }
  }
  return `${html}</section>`;
}

export const kindLabel = (k: keyof typeof KIND_LABEL) => KIND_LABEL[k];

/** 차트용 짧은 시점 이름(예: 2-1 1회, 1-1 학기). 사용자가 이름을 바꾼 시점은 그 이름을 쓴다. */
export function shortTpLabel(ds: Dataset): (id: string) => string {
  return (id) => {
    const t = ds.timepoints.find((x) => x.id === id);
    if (!t) return id;
    if (t.label !== defaultLabel(t)) return t.label;
    const gs = `${t.grade ?? '?'}-${t.semester ?? '?'}`;
    return t.kind === 'exam' ? `${gs} ${t.round ?? '?'}회` : `${gs} 학기`;
  };
}

const ymd = (d: Date) => `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;

/**
 * 학생·학부모 전달용 A4 1쪽 리포트. z·석차·내부 지표 없이 원점수, 학급·학년 평균, 변화만 보여 준다.
 * 시점이 많으면 표에는 첫 시점과 최근 5개 시점만 싣는다.
 */
export interface ParentOptions {
  /** undefined: 손글씨용 빈 칸, 문자열: 입력한 의견, null: 의견 칸 없음 */
  comment?: string | null;
}

export function parentReport(ctx: ViewCtx, stu: string, generatedAt: Date, opts: ParentOptions = {}): string {
  const { m, ds } = ctx;
  const lab = tpLabelOf(ds);
  const st = ds.students.find((s) => s.key === stu);
  const subjects = m.items.filter((i) => i.id !== AVG);
  const has = (tp: string) => m.items.some((i) => m.cell(i.id, tp, stu));
  const tps = m.tpIds.filter(has);
  const cols = tps.length > 6 ? [tps[0], ...tps.slice(-5)] : tps;
  const first = tps[0];
  const last = tps.at(-1);
  const avg = (tp: string | undefined) => (tp ? m.cell(AVG, tp, stu) : undefined);
  const trend = studentTrend(m, AVG, stu, 'raw', ctx.settings);
  const delta = first && last && first !== last && avg(first) && avg(last) ? avg(last)!.raw! - avg(first)!.raw! : null;
  const devLast = avg(last)?.dev ?? null;
  const gmLast = last ? (m.stat(AVG, last)?.gradeMean ?? null) : null;
  const period = first ? (first === last ? lab(first) : `${lab(first)} ~ ${lab(last!)}`) : '자료 없음';
  const tone = (d: number | null) => (d === null ? '' : d > 0 ? ' up' : d < 0 ? ' down' : '');

  let html = `<header class="pr-head"><div><p class="pr-kicker">학생 성적 변화 안내</p><h2>${esc(ctx.nameOf(stu))}</h2><p class="meta">${esc(ds.classLabel ?? '')}${st?.nos.length ? ` ${st.nos[0]}번` : ''}</p></div><div class="pr-period"><span>비교 기간</span><strong>${esc(period)}</strong><span>발행 ${ymd(generatedAt)}</span></div></header>`;

  html += `<div class="pr-kpis">
    <div class="pr-kpi"><span>최근 평균</span><strong>${avg(last) ? `${fmt(avg(last)!.raw)}점` : '–'}</strong><em>${last ? esc(lab(last)) : ''}</em></div>
    <div class="pr-kpi${tone(delta)}"><span>처음 대비 변화</span><strong>${delta === null ? '–' : `${fmtSigned(delta)}점`}</strong><em>${first && first !== last ? `${esc(lab(first))} 대비` : '비교 시험 1개'}</em></div>
    <div class="pr-kpi${tone(devLast)}"><span>학년 평균과 비교</span><strong>${devLast === null ? '–' : `${fmtSigned(devLast)}점`}</strong><em>${gmLast === null ? '학년 평균 자료 없음' : `학년 평균 ${fmt(gmLast)}점`}</em></div>
    <div class="pr-kpi"><span>흐름</span><strong class="trend trend-${trend.label === '상승' ? 'up' : trend.label === '하락' ? 'down' : 'flat'}">${trend.label === '판단 불가' ? '–' : trend.label}</strong><em>반 안에서의 위치 변화 기준</em></div>
  </div>`;

  const short = shortTpLabel(ds);
  const line = lineChart({
    title: '평균 점수 변화 (공통 과목)', xLabels: tps.map(short), width: 340, height: 90, compact: true, yMin: 0, yMax: 100,
    series: [
      { name: '학생', values: tps.map((tp) => avg(tp)?.raw ?? null), style: 0 },
      { name: '학급 평균', values: tps.map((tp) => m.stat(AVG, tp)?.mean ?? null), reference: true },
      { name: '학년 평균', values: tps.map((tp) => m.stat(AVG, tp)?.gradeMean ?? null), style: 5 },
    ],
  });
  const lastSubjects = last ? subjects.filter((i) => m.cell(i.id, last, stu)) : [];
  const bars = last
    ? groupedBarChart({
        title: `과목별 점수: ${lab(last)}`, labels: lastSubjects.map((i) => i.label), width: 340, height: 90, yMin: 0, yMax: 100, showValues: true,
        series: [
          { name: '학생', values: lastSubjects.map((i) => m.cell(i.id, last, stu)?.raw ?? null) },
          { name: '학년 평균', values: lastSubjects.map((i) => m.stat(i.id, last)?.gradeMean ?? null), muted: true },
        ],
      })
    : '';
  // 막대그래프와 같은 과목(최근 시험 과목)만 그려 범례를 짧게 유지
  const zSeries = (lastSubjects.length ? lastSubjects : subjects)
    .map((i) => ({ name: i.label, values: tps.map((tp) => m.cell(i.id, tp, stu)?.z ?? null), style: subjects.indexOf(i) }))
    .filter((x) => x.values.some((v) => v !== null));
  const zr = Math.max(2, ...zSeries.flatMap((x) => x.values).filter((v): v is number => v !== null).map((v) => Math.ceil(Math.abs(v))));
  const zLine = lineChart({ title: '표준화 추이 (z점수, 0 = 반 평균)', xLabels: tps.map(short), width: 340, height: 90, compact: true, yMin: -zr, yMax: zr, band: [-1, 1], hlines: [{ y: 0, label: '반 평균' }], series: zSeries });
  const lines = interpretParent(m, stu, lab);
  html += `<div class="pr-grid"><figure class="chart">${line}</figure><figure class="chart">${zLine}</figure><figure class="chart">${bars}</figure><section class="pr-notes"><h3>한눈에 보기</h3><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section></div>`;

  const rows = [...subjects.filter((i) => cols.some((tp) => m.cell(i.id, tp, stu))), ...m.items.filter((i) => i.id === AVG)].map((i) => {
    const vals = cols.map((tp) => m.cell(i.id, tp, stu)?.raw ?? null);
    const present = vals.filter((v): v is number => v !== null);
    const d = present.length >= 2 ? present.at(-1)! - present[0] : null;
    const isAvg = i.id === AVG;
    return `<tr${isAvg ? ' class="pr-avg"' : ''}><th scope="row">${esc(isAvg ? '공통 과목 평균' : i.label)}</th>${vals.map((v) => `<td>${fmt(v)}</td>`).join('')}<td class="${d === null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}">${fmtSigned(d)}</td></tr>`;
  });
  html += `<section class="pr-table"><h3>시험별 점수${tps.length > cols.length ? ` <small>(첫 시험과 최근 ${cols.length - 1}개)</small>` : ''}</h3><table class="data"><thead><tr><th>과목</th>${cols.map((tp) => `<th>${esc(lab(tp))}</th>`).join('')}<th>변화</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>`;

  if (opts.comment !== null) {
    const text = opts.comment?.trim();
    html += `<section class="pr-comment"><h3>선생님 의견</h3>${text ? `<div class="pr-comment-text">${esc(text)}</div>` : '<div class="pr-lines"><span></span><span></span><span></span></div>'}</section>`;
  }
  html += `<footer class="pr-foot"><p>점수는 원점수(만점 100) 기준입니다. 학급 평균은 우리 반, 학년 평균은 학년 전체 응시생 평균입니다. 공통 과목 평균은 비교한 모든 시험에 있는 과목(${esc(m.common.join('·') || '없음')})의 평균입니다. 표준화 점수(z)는 반 평균을 0으로 두고 반 안에서의 상대 위치를 나타냅니다(+1 이상이면 평균보다 꽤 높음).${m.mixedKinds ? ' 학기 성적에는 수행평가가 포함될 수 있습니다.' : ''}</p><p>이 안내문에는 학생 개인정보가 들어 있습니다. 보관과 전달에 유의해 주세요.</p></footer>`;
  return html;
}
