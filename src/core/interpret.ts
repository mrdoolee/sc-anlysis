// 규칙 기반 해석 문장(외부 AI 사용 안 함). 이름은 넣지 않는다.
import { AVG, studentTrend, type Matrix } from './analysis.ts';
import type { Settings } from './settings.ts';
import { fmt, fmtSigned } from './stats.ts';

export function interpretStudent(m: Matrix, stu: string, settings: Settings, tpLabel: (id: string) => string): string[] {
  const out: string[] = [];
  const label = (id: string) => m.items.find((i) => i.id === id)?.label ?? id;
  if (m.tpIds.length < 2) {
    out.push('선택한 시점이 1개라 추세를 판단할 수 없습니다. 비교할 시점을 2개 이상 선택하세요.');
  }
  const avg = studentTrend(m, AVG, stu, 'raw', settings);
  const pts = m.tpIds.map((tp, i) => ({ tp, v: avg.values[i], z: avg.zs[i] })).filter((p) => p.v !== null);
  if (!m.common.length) out.push('선택한 시점들에 공통으로 있는 과목이 없어 평균 비교를 생략했습니다.');
  else if (pts.length >= 2) {
    const a = pts[0];
    const b = pts.at(-1)!;
    const zText = a.z !== null && b.z !== null ? ` 학급 내 상대 위치(z)는 ${fmtSigned(a.z, 2)} → ${fmtSigned(b.z, 2)}로 '${avg.label}'입니다.` : '';
    out.push(`공통 과목 평균(${m.common.join('·')})은 ${tpLabel(a.tp)} ${fmt(a.v)}점에서 ${tpLabel(b.tp)} ${fmt(b.v)}점으로 ${fmtSigned(avg.delta)}점 변했습니다.${zText}`);
    if (avg.slope !== null && Math.abs(avg.slope) >= 0.5) out.push(`시점마다 평균 ${fmt(Math.abs(avg.slope))}점씩 ${avg.slope > 0 ? '오르는' : '내리는'} 경향입니다.`);
    if (avg.volatility !== null && avg.volatility >= 0.75) out.push(`시점별 상대 위치의 변동이 큰 편입니다(z 표준편차 ${fmt(avg.volatility, 2)}).`);
  }

  const subjectItems = m.items.filter((i) => i.id !== AVG);
  const deltas = subjectItems
    .map((i) => ({ id: i.id, d: studentTrend(m, i.id, stu, 'raw', settings).deltaZ }))
    .filter((x): x is { id: string; d: number } => x.d !== null)
    .sort((x, y) => y.d - x.d);
  const th = settings.trendThreshold;
  const ups = deltas.filter((x) => x.d >= th);
  const downs = deltas.filter((x) => x.d <= -th).reverse();
  if (deltas.length) {
    if (!ups.length && !downs.length) out.push(`과목별 상대 위치 변화는 모두 ±${th} z 이내로 큰 변화가 없습니다.`);
    else {
      const parts: string[] = [];
      if (ups.length) parts.push(`많이 오른 과목은 ${ups.slice(0, 3).map((x) => `${label(x.id)}(${fmtSigned(x.d, 2)})`).join(', ')}`);
      if (downs.length) parts.push(`많이 내린 과목은 ${downs.slice(0, 3).map((x) => `${label(x.id)}(${fmtSigned(x.d, 2)})`).join(', ')}`);
      out.push(`${parts.join('이고, ')}입니다(Δz 기준).`);
    }
  }

  const last = [...m.tpIds].reverse().find((tp) => subjectItems.some((i) => m.cell(i.id, tp, stu)));
  if (last) {
    const zs = subjectItems
      .map((i) => ({ id: i.id, z: m.cell(i.id, last, stu)?.z ?? null }))
      .filter((x): x is { id: string; z: number } => x.z !== null)
      .sort((a, b) => b.z - a.z);
    if (zs.length >= 3) out.push(`${tpLabel(last)} 기준 상대적 강점은 ${zs.slice(0, 2).map((x) => label(x.id)).join('·')}, 보완이 필요한 과목은 ${zs.slice(-2).reverse().map((x) => label(x.id)).join('·')}입니다.`);
    const devs = subjectItems.map((i) => m.cell(i.id, last, stu)?.dev).filter((d): d is number => d !== null && d !== undefined);
    if (devs.length) out.push(`${tpLabel(last)}에 학년 평균보다 높은 과목 ${devs.filter((d) => d > 0).length}개, 낮은 과목 ${devs.filter((d) => d < 0).length}개입니다.`);
    const c = m.cell(AVG, last, stu);
    const st = m.stat(AVG, last);
    if (c?.rank && st) out.push(`${tpLabel(last)} 공통 과목 평균 학급 석차는 ${c.rank}/${st.n}위(백분위 ${fmt(c.pr, 0)})입니다.`);
  }
  if (m.mixedKinds) out.push('학기 성적(수행평가 등 포함 가능)과 지필고사 점수는 측정 기준이 다를 수 있으므로 원점수 차이는 참고로만 보세요.');
  return out;
}

/** 학생·학부모용 쉬운 문장(원점수·학년 평균 기준, z·석차 표현 없음). 최대 5문장. */
export function interpretParent(m: Matrix, stu: string, tpLabel: (id: string) => string): string[] {
  const out: string[] = [];
  const label = (id: string) => m.items.find((i) => i.id === id)?.label ?? id;
  const pts = m.tpIds.map((tp) => ({ tp, c: m.cell(AVG, tp, stu) })).filter((p) => p.c);
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts.at(-1)!;
    const d = b.c!.raw! - a.c!.raw!;
    const verb = Math.abs(d) < 1 ? '비슷하게 유지되었습니다' : d > 0 ? `${fmt(d)}점 올랐습니다` : `${fmt(-d)}점 내렸습니다`;
    out.push(`공통 과목 평균 점수가 ${tpLabel(a.tp)} ${fmt(a.c!.raw)}점에서 ${tpLabel(b.tp)} ${fmt(b.c!.raw)}점으로 ${verb}.`);
  } else if (m.tpIds.length < 2) out.push('비교할 시험이 1개라 점수 변화는 표시하지 않습니다.');
  const lastAvg = pts.at(-1);
  if (lastAvg?.c?.dev !== null && lastAvg?.c?.dev !== undefined) {
    const dv = lastAvg.c.dev;
    out.push(`${tpLabel(lastAvg.tp)} 평균은 학년 평균보다 ${fmt(Math.abs(dv))}점 ${dv >= 0 ? '높습니다' : '낮습니다'}.`);
  }
  const subjects = m.items.filter((i) => i.id !== AVG);
  const last = [...m.tpIds].reverse().find((tp) => subjects.some((i) => m.cell(i.id, tp, stu)));
  if (last) {
    const devs = subjects
      .map((i) => ({ id: i.id, d: m.cell(i.id, last, stu)?.dev ?? null }))
      .filter((x): x is { id: string; d: number } => x.d !== null)
      .sort((x, y) => y.d - x.d);
    const strong = devs.filter((x) => x.d >= 1).slice(0, 3);
    const weak = devs.filter((x) => x.d <= -1).reverse().slice(0, 2);
    if (strong.length) out.push(`학년 평균보다 높은 과목: ${strong.map((x) => `${label(x.id)}(${fmtSigned(x.d)}점)`).join(', ')}.`);
    if (weak.length) out.push(`조금 더 관심이 필요한 과목: ${weak.map((x) => `${label(x.id)}(${fmtSigned(x.d)}점)`).join(', ')}.`);
  }
  const gains = subjects
    .map((i) => {
      const vs = m.tpIds.map((tp) => m.cell(i.id, tp, stu)?.raw ?? null).filter((v): v is number => v !== null);
      return { id: i.id, d: vs.length >= 2 ? vs.at(-1)! - vs[0] : null };
    })
    .filter((x): x is { id: string; d: number } => x.d !== null && x.d >= 3)
    .sort((x, y) => y.d - x.d);
  if (gains.length && out.length < 5) out.push(`가장 많이 오른 과목은 ${label(gains[0].id)}(${fmtSigned(gains[0].d)}점)입니다.`);
  if (m.mixedKinds && out.length < 5) out.push('학기 성적에는 수행평가가 포함될 수 있어 시험 점수와 차이가 날 수 있습니다.');
  return out.slice(0, 5);
}
