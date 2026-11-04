// 문자열 기반 SVG 차트. style 속성 없이 표현 속성(fill, stroke…)만 쓰므로 엄격한 CSP와 호환되고,
// 같은 문자열을 화면·인쇄·HTML 내보내기에 그대로 사용한다. 툴팁은 <title> 요소.

/** 색각 이상 안전 팔레트(Okabe–Ito 기반, 1번은 디자인 기본색 #1D4ED8) */
export const PALETTE = ['#1D4ED8', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#0284C7', '#0B2545', '#882255', '#117733', '#999933'];
const DASHES = ['', '7 3', '2 3', '9 3 2 3', '4 2 1 2', '12 4', '3 6', '6 2 2 2 2 2'];
const MARKERS = ['circle', 'square', 'triangle', 'diamond', 'cross', 'tri-down', 'plus', 'star'] as const;
const INK = '#0B2545';
const MUTED = '#666';
const GRID = '#e3e3e3';

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const n2 = (x: number) => Math.round(x * 100) / 100;
const f1 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : x.toFixed(1));

export function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(n2(v) + 0);
  return out;
}

function marker(kind: number, x: number, y: number, color: string, tip: string, extra = ''): string {
  const m = MARKERS[kind % MARKERS.length];
  const t = tip ? `<title>${esc(tip)}</title>` : '';
  const s = 4;
  const common = `fill="${color}" stroke="#fff" stroke-width="1" ${extra}`;
  switch (m) {
    case 'square':
      return `<rect x="${n2(x - s)}" y="${n2(y - s)}" width="${2 * s}" height="${2 * s}" ${common}>${t}</rect>`;
    case 'triangle':
      return `<path d="M${n2(x)} ${n2(y - s - 1)}L${n2(x + s + 1)} ${n2(y + s)}L${n2(x - s - 1)} ${n2(y + s)}Z" ${common}>${t}</path>`;
    case 'tri-down':
      return `<path d="M${n2(x)} ${n2(y + s + 1)}L${n2(x + s + 1)} ${n2(y - s)}L${n2(x - s - 1)} ${n2(y - s)}Z" ${common}>${t}</path>`;
    case 'diamond':
      return `<path d="M${n2(x)} ${n2(y - s - 1)}L${n2(x + s + 1)} ${n2(y)}L${n2(x)} ${n2(y + s + 1)}L${n2(x - s - 1)} ${n2(y)}Z" ${common}>${t}</path>`;
    case 'cross':
      return `<g ${extra}><path d="M${n2(x - s)} ${n2(y - s)}L${n2(x + s)} ${n2(y + s)}M${n2(x + s)} ${n2(y - s)}L${n2(x - s)} ${n2(y + s)}" stroke="${color}" stroke-width="2.5"/>${t ? `<circle cx="${n2(x)}" cy="${n2(y)}" r="${s + 1}" fill="transparent">${t}</circle>` : ''}</g>`;
    case 'plus':
      return `<g ${extra}><path d="M${n2(x - s - 1)} ${n2(y)}L${n2(x + s + 1)} ${n2(y)}M${n2(x)} ${n2(y - s - 1)}L${n2(x)} ${n2(y + s + 1)}" stroke="${color}" stroke-width="2.5"/>${t ? `<circle cx="${n2(x)}" cy="${n2(y)}" r="${s + 1}" fill="transparent">${t}</circle>` : ''}</g>`;
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 ? s * 0.5 : s + 1.5;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        return `${n2(x + r * Math.cos(a))} ${n2(y + r * Math.sin(a))}`;
      });
      return `<path d="M${pts.join('L')}Z" ${common}>${t}</path>`;
    }
    default:
      return `<circle cx="${n2(x)}" cy="${n2(y)}" r="${s}" ${common}>${t}</circle>`;
  }
}

/** 긴 라벨을 최대 2줄로 나눈다 */
function wrap(label: string, max = 9): string[] {
  if (label.length <= max) return [label];
  const words = label.split(/\s+/);
  const lines: string[] = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (cur && (cur + ' ' + w).length > max && lines.length < 2) lines.push(w);
    else lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
  }
  return lines;
}

function frame(w: number, h: number, title: string, body: string, desc = '', cls = ''): string {
  return `<svg class="chart-svg${cls ? ` ${cls}` : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${desc ? `<desc>${esc(desc)}</desc>` : ''}<text x="8" y="18" font-size="13" font-weight="700" fill="${INK}">${esc(title)}</text>${body}</svg>`;
}

export interface Series {
  name: string;
  values: (number | null)[];
  /** 팔레트·선 종류·마커 인덱스 */
  style?: number;
  /** 회색 점선 기준선(학급평균 등) */
  reference?: boolean;
  tips?: string[];
}

interface Legend {
  svg: string;
  height: number;
}

function legend(series: { name: string; style: number; reference?: boolean }[], x0: number, y0: number, width: number): Legend {
  let x = x0;
  let y = y0;
  let out = '';
  for (const s of series) {
    const w = 34 + s.name.length * 12;
    if (x + w > x0 + width && x > x0) {
      x = x0;
      y += 18;
    }
    const color = s.reference ? MUTED : PALETTE[s.style % PALETTE.length];
    const dash = s.reference ? '4 3' : DASHES[s.style % DASHES.length];
    out += `<line x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    if (!s.reference) out += marker(s.style, x + 11, y, color, '');
    out += `<text x="${x + 27}" y="${y + 4}" font-size="11" fill="${INK}">${esc(s.name)}</text>`;
    x += w;
  }
  return { svg: out, height: series.length ? y - y0 + 18 : 0 };
}

function measureLegend(names: string[], width: number): number {
  let x = 0;
  let rows = names.length ? 1 : 0;
  for (const n of names) {
    const w = 34 + n.length * 12;
    if (x + w > width && x > 0) {
      x = 0;
      rows++;
    }
    x += w;
  }
  return rows * 18;
}

function xAxis(labels: string[], xAt: (i: number) => number, y: number): { svg: string; height: number } {
  const slot = labels.length > 1 ? xAt(1) - xAt(0) : 200;
  // 한 줄에 들어가는 글자 수에 맞춰 줄바꿈하고, 그래도 넘치면 기울인다.
  const maxChars = Math.max(3, Math.min(9, Math.floor(slot / 10.5)));
  const wrapped = labels.map((l) => wrap(l, maxChars));
  const rotate = labels.length > 8 || wrapped.some((ls) => ls.some((line) => line.length > maxChars + 0.5));
  let out = '';
  labels.forEach((l, i) => {
    const x = xAt(i);
    if (rotate) out += `<text x="${n2(x)}" y="${y + 12}" font-size="10" fill="${INK}" text-anchor="end" transform="rotate(-35 ${n2(x)} ${y + 12})">${esc(l)}</text>`;
    else
      wrapped[i].forEach((line, k) => {
        out += `<text x="${n2(x)}" y="${y + 14 + k * 12}" font-size="10.5" fill="${INK}" text-anchor="middle">${esc(line)}</text>`;
      });
  });
  const longest = Math.max(0, ...labels.map((l) => l.length));
  return { svg: out, height: rotate ? Math.min(90, 14 + longest * 6) : 14 + 12 * Math.max(1, ...wrapped.map((ls) => ls.length)) };
}

function yAxis(ticks: number[], yAt: (v: number) => number, x0: number, x1: number, label?: string, fmtTick = (v: number) => String(v)): string {
  let out = '';
  for (const t of ticks) {
    const y = n2(yAt(t));
    out += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}" stroke-width="1"/><text x="${x0 - 6}" y="${y + 4}" font-size="10.5" fill="${MUTED}" text-anchor="end">${esc(fmtTick(t))}</text>`;
  }
  if (label) out += `<text x="${x0}" y="34" font-size="10.5" fill="${MUTED}" text-anchor="start">${esc(label)}</text>`;
  return out;
}

export interface LineOptions {
  title: string;
  xLabels: string[];
  series: Series[];
  yMin: number;
  yMax: number;
  yLabel?: string;
  /** 음영 밴드(예: z −1~+1) */
  band?: [number, number];
  hlines?: { y: number; label: string }[];
  width?: number;
  height?: number;
  desc?: string;
}

export function lineChart(o: LineOptions): string {
  const W = o.width ?? 680;
  const plotH = o.height ?? 220;
  const pad = { l: 46, r: 18, t: 42 };
  const plotW = W - pad.l - pad.r;
  const n = o.xLabels.length;
  const xAt = (i: number) => pad.l + (plotW * (i + 0.5)) / Math.max(1, n);
  const yAt = (v: number) => pad.t + plotH * (1 - (Math.min(o.yMax, Math.max(o.yMin, v)) - o.yMin) / (o.yMax - o.yMin || 1));
  const xa = xAxis(o.xLabels, xAt, pad.t + plotH);
  const legH = measureLegend(o.series.map((s) => s.name), plotW);
  const H = pad.t + plotH + xa.height + legH + 10;
  let body = yAxis(niceTicks(o.yMin, o.yMax), yAt, pad.l, W - pad.r, o.yLabel);
  if (o.band) body += `<rect x="${pad.l}" y="${n2(yAt(o.band[1]))}" width="${plotW}" height="${n2(yAt(o.band[0]) - yAt(o.band[1]))}" fill="#0072B2" fill-opacity="0.07"/>`;
  for (const h of o.hlines ?? [])
    body += `<line x1="${pad.l}" y1="${n2(yAt(h.y))}" x2="${W - pad.r}" y2="${n2(yAt(h.y))}" stroke="${INK}" stroke-width="1"/><text x="${W - pad.r - 2}" y="${n2(yAt(h.y)) - 3}" font-size="10" fill="${MUTED}" text-anchor="end">${esc(h.label)}</text>`;
  o.series.forEach((s, si) => {
    const st = s.style ?? si;
    const color = s.reference ? MUTED : PALETTE[st % PALETTE.length];
    const dash = s.reference ? '4 3' : DASHES[st % DASHES.length];
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${n2(xAt(i))} ${n2(yAt(v))}`;
      pen = true;
    });
    if (d) body += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${s.reference ? 1.5 : 2.2}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    if (!s.reference)
      s.values.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) return;
        body += marker(st, xAt(i), yAt(v), color, s.tips?.[i] ?? `${s.name} · ${o.xLabels[i]}: ${f1(v)}`);
      });
  });
  body += xa.svg;
  body += legend(o.series.map((s, i) => ({ name: s.name, style: s.style ?? i, reference: s.reference })), pad.l, pad.t + plotH + xa.height + 6, plotW).svg;
  return frame(W, H, o.title, body, o.desc);
}

export interface BarOptions {
  title: string;
  labels: string[];
  values: (number | null)[];
  yLabel?: string;
  /** 0 기준 양/음 색 구분 */
  signed?: boolean;
  yMin?: number;
  yMax?: number;
  width?: number;
  height?: number;
  digits?: number;
}

export function barChart(o: BarOptions): string {
  const W = o.width ?? 680;
  const plotH = o.height ?? 190;
  const pad = { l: 46, r: 18, t: 42 };
  const plotW = W - pad.l - pad.r;
  const vals = o.values.filter((v): v is number => v !== null);
  let yMin = o.yMin ?? Math.min(0, ...vals);
  let yMax = o.yMax ?? Math.max(0, ...vals);
  if (yMin === yMax) yMax = yMin + 1;
  if (o.signed && o.yMin === undefined) {
    const m = Math.max(Math.abs(yMin), Math.abs(yMax)) * 1.15 || 1;
    yMin = -m;
    yMax = m;
  }
  const ticks = niceTicks(yMin, yMax);
  yMin = Math.min(yMin, ticks[0]);
  yMax = Math.max(yMax, ticks.at(-1)!);
  const n = o.labels.length;
  const slot = plotW / Math.max(1, n);
  const xAt = (i: number) => pad.l + slot * (i + 0.5);
  const yAt = (v: number) => pad.t + plotH * (1 - (v - yMin) / (yMax - yMin));
  const xa = xAxis(o.labels, xAt, pad.t + plotH);
  let body = yAxis(ticks, yAt, pad.l, W - pad.r, o.yLabel);
  body += `<line x1="${pad.l}" y1="${n2(yAt(0))}" x2="${W - pad.r}" y2="${n2(yAt(0))}" stroke="${INK}" stroke-width="1"/>`;
  const bw = Math.min(46, slot * 0.6);
  o.values.forEach((v, i) => {
    const x = xAt(i) - bw / 2;
    if (v === null) {
      body += `<text x="${n2(xAt(i))}" y="${n2(yAt(0)) - 4}" font-size="10" fill="${MUTED}" text-anchor="middle">–</text>`;
      return;
    }
    const y0 = yAt(Math.max(0, v));
    const y1 = yAt(Math.min(0, v));
    const color = o.signed ? (v >= 0 ? PALETTE[0] : PALETTE[1]) : PALETTE[0];
    const pattern = o.signed && v < 0 ? ' stroke="#000" stroke-width="0.8" stroke-dasharray="3 2"' : '';
    const txt = o.signed ? (v > 0 ? `+${v.toFixed(o.digits ?? 1)}` : v.toFixed(o.digits ?? 1)) : v.toFixed(o.digits ?? 1);
    body += `<rect x="${n2(x)}" y="${n2(y0)}" width="${n2(bw)}" height="${n2(Math.max(1, y1 - y0))}" fill="${color}"${pattern}><title>${esc(`${o.labels[i]}: ${txt}`)}</title></rect>`;
    body += `<text x="${n2(xAt(i))}" y="${n2(v >= 0 ? y0 - 4 : y1 + 12)}" font-size="10.5" fill="${INK}" text-anchor="middle">${esc(txt)}</text>`;
  });
  body += xa.svg;
  return frame(W, pad.t + plotH + xa.height + 8, o.title, body);
}

export interface GroupedBarOptions {
  title: string;
  labels: string[];
  series: { name: string; values: (number | null)[]; muted?: boolean }[];
  yMin: number;
  yMax: number;
  width?: number;
  height?: number;
  /** 첫 계열 막대 위에 값 표시 */
  showValues?: boolean;
}

/** 묶은 세로 막대(예: 과목별 내 점수 vs 학년 평균) */
export function groupedBarChart(o: GroupedBarOptions): string {
  const W = o.width ?? 680;
  const plotH = o.height ?? 180;
  const pad = { l: 34, r: 8, t: 34 };
  const plotW = W - pad.l - pad.r;
  const slot = plotW / Math.max(1, o.labels.length);
  const k = o.series.length;
  const bw = Math.min(22, (slot * 0.76) / k);
  const xAt = (i: number) => pad.l + slot * (i + 0.5);
  const yAt = (v: number) => pad.t + plotH * (1 - (Math.min(o.yMax, Math.max(o.yMin, v)) - o.yMin) / (o.yMax - o.yMin || 1));
  const xa = xAxis(o.labels, xAt, pad.t + plotH);
  let body = yAxis(niceTicks(o.yMin, o.yMax, 4), yAt, pad.l, W - pad.r);
  o.labels.forEach((label, i) => {
    o.series.forEach((s, j) => {
      const v = s.values[i];
      if (v === null || v === undefined) return;
      const x = xAt(i) - (bw * k) / 2 + j * bw;
      const y = yAt(v);
      const fill = s.muted ? '#94A3B8' : PALETTE[j % PALETTE.length];
      body += `<rect x="${n2(x + 1)}" y="${n2(y)}" width="${n2(bw - 2)}" height="${n2(Math.max(1, yAt(o.yMin) - y))}" rx="2" fill="${fill}"><title>${esc(`${label} · ${s.name}: ${f1(v)}`)}</title></rect>`;
      if (o.showValues && j === 0) body += `<text x="${n2(x + bw / 2)}" y="${n2(y - 3)}" font-size="9.5" fill="${INK}" text-anchor="middle">${esc(f1(v))}</text>`;
    });
  });
  body += xa.svg;
  let lx = pad.l;
  const ly = pad.t + plotH + xa.height + 6;
  o.series.forEach((s, j) => {
    body += `<rect x="${lx}" y="${ly - 5}" width="10" height="10" rx="2" fill="${s.muted ? '#94A3B8' : PALETTE[j % PALETTE.length]}"/><text x="${lx + 14}" y="${ly + 4}" font-size="10.5" fill="${INK}">${esc(s.name)}</text>`;
    lx += 26 + s.name.length * 11;
  });
  return frame(W, ly + 12, o.title, body);
}

export interface RadarOptions {
  title: string;
  axes: string[];
  series: Series[];
  min: number;
  max: number;
  width?: number;
}

export function radarChart(o: RadarOptions): string {
  const W = o.width ?? 420;
  if (o.axes.length < 3) return frame(W, 70, o.title, `<text x="8" y="46" font-size="12" fill="${MUTED}">공통 과목이 3개 이상일 때 표시합니다.</text>`);
  const legH = measureLegend(o.series.map((s) => s.name), W - 30);
  const R = W / 2 - 70;
  const cx = W / 2;
  const cy = 44 + R + 20;
  const k = o.axes.length;
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / k;
  const rad = (v: number) => (R * (Math.min(o.max, Math.max(o.min, v)) - o.min)) / (o.max - o.min || 1);
  let body = '';
  for (const t of niceTicks(o.min, o.max, 4)) {
    const pts = o.axes.map((_, i) => `${n2(cx + rad(t) * Math.cos(ang(i)))} ${n2(cy + rad(t) * Math.sin(ang(i)))}`);
    body += `<path d="M${pts.join('L')}Z" fill="none" stroke="${GRID}"/><text x="${n2(cx + 3)}" y="${n2(cy - rad(t) - 2)}" font-size="9.5" fill="${MUTED}">${t}</text>`;
  }
  o.axes.forEach((a, i) => {
    const x = cx + (R + 14) * Math.cos(ang(i));
    const y = cy + (R + 14) * Math.sin(ang(i));
    const anchor = Math.abs(Math.cos(ang(i))) < 0.2 ? 'middle' : Math.cos(ang(i)) > 0 ? 'start' : 'end';
    body += `<line x1="${cx}" y1="${cy}" x2="${n2(cx + R * Math.cos(ang(i)))}" y2="${n2(cy + R * Math.sin(ang(i)))}" stroke="${GRID}"/><text x="${n2(x)}" y="${n2(y + 4)}" font-size="11" fill="${INK}" text-anchor="${anchor}">${esc(a)}</text>`;
  });
  o.series.forEach((s, si) => {
    const st = s.style ?? si;
    const color = PALETTE[st % PALETTE.length];
    const dash = DASHES[st % DASHES.length];
    const pts = s.values.map((v, i) => (v === null ? null : ([cx + rad(v) * Math.cos(ang(i)), cy + rad(v) * Math.sin(ang(i))] as const)));
    const ok = pts.filter((p): p is readonly [number, number] => p !== null);
    if (ok.length >= 2) body += `<path d="M${ok.map((p) => `${n2(p[0])} ${n2(p[1])}`).join('L')}Z" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    pts.forEach((p, i) => {
      if (p) body += marker(st, p[0], p[1], color, `${s.name} · ${o.axes[i]}: ${f1(s.values[i])}`);
    });
  });
  body += legend(o.series.map((s, i) => ({ name: s.name, style: s.style ?? i })), 15, cy + R + 34, W - 30).svg;
  return frame(W, cy + R + 34 + legH + 4, o.title, body, '', 'compact');
}

export interface HeatmapOptions {
  title: string;
  rows: string[];
  /** 행 클릭 시 학생 상세로 이동하기 위한 키 */
  rowKeys?: string[];
  cols: string[];
  values: (number | null)[][];
  /** 색 대칭 범위(±) */
  domain?: number;
  digits?: number;
  width?: number;
}

function divergent(v: number, domain: number): string {
  const t = Math.max(-1, Math.min(1, v / domain));
  const to = t >= 0 ? [33, 102, 172] : [178, 24, 43];
  const a = Math.abs(t);
  const c = [255, 255, 255].map((w, i) => Math.round(w + (to[i] - w) * a));
  return `rgb(${c.join(',')})`;
}

export function heatmap(o: HeatmapOptions): string {
  const W = o.width ?? 680;
  const labelW = Math.min(150, 20 + Math.max(4, ...o.rows.map((r) => r.length)) * 11);
  const top = 42 + 14 + 12 * Math.max(1, ...o.cols.map((c) => wrap(c, 8).length));
  const rowH = 18;
  const cellW = (W - labelW - 12) / Math.max(1, o.cols.length);
  const domain = o.domain ?? 2.5;
  let body = '';
  o.cols.forEach((c, j) =>
    wrap(c, 8).forEach((line, k) => {
      body += `<text x="${n2(labelW + cellW * (j + 0.5))}" y="${46 + k * 12}" font-size="10" fill="${INK}" text-anchor="middle">${esc(line)}</text>`;
    }),
  );
  o.rows.forEach((r, i) => {
    const y = top + i * rowH;
    const key = o.rowKeys?.[i];
    body += `<g${key ? ` class="hm-row" data-student="${esc(key)}"` : ''}><text x="${labelW - 6}" y="${y + 13}" font-size="11" fill="${INK}" text-anchor="end">${esc(r)}</text>`;
    o.cols.forEach((c, j) => {
      const v = o.values[i]?.[j] ?? null;
      const x = labelW + j * cellW;
      const fill = v === null ? '#f0f0f0' : divergent(v, domain);
      const dark = v !== null && Math.abs(v) / domain > 0.6;
      body += `<rect x="${n2(x + 0.5)}" y="${y + 0.5}" width="${n2(cellW - 1)}" height="${rowH - 1}" fill="${fill}"><title>${esc(`${r} · ${c}: ${v === null ? '없음' : v.toFixed(o.digits ?? 2)}`)}</title></rect>`;
      body += `<text x="${n2(x + cellW / 2)}" y="${y + 13}" font-size="10" fill="${dark ? '#fff' : INK}" text-anchor="middle">${v === null ? '–' : esc(v.toFixed(o.digits ?? 1))}</text>`;
    });
    body += '</g>';
  });
  const legY = top + o.rows.length * rowH + 14;
  const steps = [-domain, -domain / 2, 0, domain / 2, domain];
  steps.forEach((s, i) => {
    body += `<rect x="${labelW + i * 46}" y="${legY}" width="44" height="12" fill="${divergent(s, domain)}" stroke="#ccc"/><text x="${labelW + i * 46 + 22}" y="${legY + 24}" font-size="9.5" fill="${MUTED}" text-anchor="middle">${s > 0 ? '+' : ''}${s}</text>`;
  });
  body += `<text x="${labelW + steps.length * 46 + 6}" y="${legY + 10}" font-size="10" fill="${MUTED}">파랑 = 학급 평균보다 높음, 빨강 = 낮음</text>`;
  return frame(W, legY + 32, o.title, body);
}

export interface Box {
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  mean: number | null;
  n: number;
}

export interface BoxOptions {
  title: string;
  labels: string[];
  boxes: Box[];
  /** 시점별 학년 평균(있으면 × 표시) */
  reference?: (number | null)[];
  yMin: number;
  yMax: number;
  yLabel?: string;
  width?: number;
}

export function boxPlot(o: BoxOptions): string {
  const W = o.width ?? 680;
  const plotH = 200;
  const pad = { l: 46, r: 18, t: 42 };
  const plotW = W - pad.l - pad.r;
  const slot = plotW / Math.max(1, o.labels.length);
  const xAt = (i: number) => pad.l + slot * (i + 0.5);
  const yAt = (v: number) => pad.t + plotH * (1 - (v - o.yMin) / (o.yMax - o.yMin || 1));
  const xa = xAxis(o.labels, xAt, pad.t + plotH);
  let body = yAxis(niceTicks(o.yMin, o.yMax), yAt, pad.l, W - pad.r, o.yLabel);
  const bw = Math.min(44, slot * 0.5);
  o.boxes.forEach((b, i) => {
    const x = xAt(i);
    if (b.min === null || b.q1 === null || b.median === null || b.q3 === null || b.max === null) return;
    const tip = `${o.labels[i]} · n=${b.n} · 최소 ${f1(b.min)} · Q1 ${f1(b.q1)} · 중앙값 ${f1(b.median)} · Q3 ${f1(b.q3)} · 최대 ${f1(b.max)} · 평균 ${f1(b.mean)}`;
    body += `<g><title>${esc(tip)}</title><line x1="${n2(x)}" y1="${n2(yAt(b.max))}" x2="${n2(x)}" y2="${n2(yAt(b.min))}" stroke="${INK}"/>`;
    body += `<line x1="${n2(x - bw / 4)}" y1="${n2(yAt(b.max))}" x2="${n2(x + bw / 4)}" y2="${n2(yAt(b.max))}" stroke="${INK}"/><line x1="${n2(x - bw / 4)}" y1="${n2(yAt(b.min))}" x2="${n2(x + bw / 4)}" y2="${n2(yAt(b.min))}" stroke="${INK}"/>`;
    body += `<rect x="${n2(x - bw / 2)}" y="${n2(yAt(b.q3))}" width="${n2(bw)}" height="${n2(Math.max(1, yAt(b.q1) - yAt(b.q3)))}" fill="#cfe3f3" stroke="${PALETTE[0]}"/>`;
    body += `<line x1="${n2(x - bw / 2)}" y1="${n2(yAt(b.median))}" x2="${n2(x + bw / 2)}" y2="${n2(yAt(b.median))}" stroke="${PALETTE[0]}" stroke-width="2.5"/></g>`;
    if (b.mean !== null) body += marker(3, x, yAt(b.mean), PALETTE[1], `${o.labels[i]} 학급 평균 ${f1(b.mean)}`);
    const r = o.reference?.[i];
    if (r !== null && r !== undefined) body += marker(4, x + bw / 2 + 8, yAt(r), MUTED, `${o.labels[i]} 학년 평균 ${f1(r)}`);
  });
  body += xa.svg;
  const ly = pad.t + plotH + xa.height + 8;
  body += `${marker(3, pad.l + 6, ly, PALETTE[1], '')}<text x="${pad.l + 16}" y="${ly + 4}" font-size="11" fill="${INK}">학급 평균</text>${marker(4, pad.l + 96, ly, MUTED, '')}<text x="${pad.l + 106}" y="${ly + 4}" font-size="11" fill="${INK}">학년 평균</text><text x="${pad.l + 186}" y="${ly + 4}" font-size="11" fill="${MUTED}">상자 = Q1~Q3, 굵은 선 = 중앙값, 수염 = 최소~최대</text>`;
  return frame(W, ly + 16, o.title, body);
}

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  key?: string;
}

export interface ScatterOptions {
  title: string;
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  min: number;
  max: number;
  width?: number;
}

export function scatterChart(o: ScatterOptions): string {
  const S = Math.min(o.width ?? 420, 420);
  const pad = 48;
  const plot = S - pad - 20;
  const top = 40;
  const sx = (v: number) => pad + (plot * (v - o.min)) / (o.max - o.min || 1);
  const sy = (v: number) => top + plot * (1 - (v - o.min) / (o.max - o.min || 1));
  const ticks = niceTicks(o.min, o.max, 5);
  let body = '';
  for (const t of ticks) {
    body += `<line x1="${n2(sx(t))}" y1="${top}" x2="${n2(sx(t))}" y2="${top + plot}" stroke="${GRID}"/><line x1="${pad}" y1="${n2(sy(t))}" x2="${pad + plot}" y2="${n2(sy(t))}" stroke="${GRID}"/>`;
    body += `<text x="${n2(sx(t))}" y="${top + plot + 14}" font-size="10" fill="${MUTED}" text-anchor="middle">${t}</text><text x="${pad - 5}" y="${n2(sy(t)) + 4}" font-size="10" fill="${MUTED}" text-anchor="end">${t}</text>`;
  }
  body += `<line x1="${n2(sx(o.min))}" y1="${n2(sy(o.min))}" x2="${n2(sx(o.max))}" y2="${n2(sy(o.max))}" stroke="${INK}" stroke-dasharray="5 4"/>`;
  body += `<text x="${pad + 6}" y="${top + 14}" font-size="10.5" fill="${PALETTE[0]}">대각선 위 = 상승</text><text x="${pad + plot - 4}" y="${top + plot - 6}" font-size="10.5" fill="${PALETTE[1]}" text-anchor="end">대각선 아래 = 하락</text>`;
  for (const p of o.points) {
    const up = p.y >= p.x;
    body += marker(up ? 0 : 2, sx(Math.min(o.max, Math.max(o.min, p.x))), sy(Math.min(o.max, Math.max(o.min, p.y))), up ? PALETTE[0] : PALETTE[1], `${p.label}: ${f1(p.x)} → ${f1(p.y)}`, p.key ? `class="pt" data-student="${esc(p.key)}"` : '');
  }
  body += `<text x="${pad + plot / 2}" y="${top + plot + 30}" font-size="11" fill="${INK}" text-anchor="middle">${esc(o.xLabel)}</text>`;
  body += `<text x="14" y="${top + plot / 2}" font-size="11" fill="${INK}" text-anchor="middle" transform="rotate(-90 14 ${top + plot / 2})">${esc(o.yLabel)}</text>`;
  return frame(S, top + plot + 40, o.title, body, '', 'compact');
}
