import { describe, expect, it } from 'vitest';
import { barChart, boxPlot, heatmap, lineChart, niceTicks, radarChart, scatterChart } from '../src/charts/svg.ts';

const all = () => [
  lineChart({ title: '추이 <b>', xLabels: ['1회', '2회', '3회'], series: [{ name: 'A&B', values: [10, null, 30] }, { name: '평균', values: [20, 20, 20], reference: true }], yMin: 0, yMax: 100, band: [-1, 1] }),
  barChart({ title: 'Δ', labels: ['국어', '수학'], values: [3, -2], signed: true }),
  radarChart({ title: 'r', axes: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 2, null] }], min: 0, max: 3 }),
  heatmap({ title: 'h', rows: ['<script>'], rowKeys: ['k"1'], cols: ['x'], values: [[1.2]] }),
  boxPlot({ title: 'b', labels: ['x'], boxes: [{ min: 1, q1: 2, median: 3, q3: 4, max: 5, mean: 3, n: 5 }], reference: [3.5], yMin: 0, yMax: 10 }),
  scatterChart({ title: 's', points: [{ x: 1, y: 2, label: '학생', key: 'k' }], xLabel: 'A', yLabel: 'B', min: 0, max: 10 }),
];

describe('SVG 차트', () => {
  it('텍스트를 이스케이프한다', () => {
    const svg = all().join('');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('A&amp;B');
    expect(svg).toContain('data-student="k&quot;1"');
  });

  it('CSP 호환: style 속성·외부 참조가 없다', () => {
    const svg = all().join('');
    expect(svg).not.toMatch(/\sstyle=/);
    expect(svg.match(/https?:\/\/[^"]+/g)?.every((u) => u === 'http://www.w3.org/2000/svg')).toBe(true);
  });

  it('결측 구간에서 선을 끊는다', () => {
    const svg = lineChart({ title: 't', xLabels: ['a', 'b', 'c'], series: [{ name: 's', values: [10, null, 30] }], yMin: 0, yMax: 100 });
    const d = /<path d="([^"]+)" fill="none"/.exec(svg)![1];
    expect(d.match(/M/g)!.length).toBe(2);
    expect(d).not.toContain('L');
  });

  it('공통 과목이 3개 미만이면 레이더 대신 안내', () => {
    expect(radarChart({ title: 'r', axes: ['a', 'b'], series: [], min: 0, max: 1 })).toContain('3개 이상');
  });

  it('눈금', () => {
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-2.5, 2.5)).toEqual([-2, -1, 0, 1, 2]);
  });
});
