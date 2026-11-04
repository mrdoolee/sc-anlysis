// LLM에 붙여 넣을 분석 요청 프롬프트. 익명 데이터만 담는다:
// 이름·학번·번호·반·학교·선생님 의견은 넣지 않고, 학생은 '대상 학생' 또는 무작위 순서의 익명 코드(S01…)로만 표시한다.
// 앱은 이 문자열을 어디에도 보내지 않으며, 교사가 내용을 확인한 뒤 직접 복사해 사용한다.
import { AVG, studentTrend, type Matrix } from './analysis.ts';
import type { Dataset } from './dataset.ts';
import type { Settings } from './settings.ts';
import { fmtSigned } from './stats.ts';

const plain = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(d));
const signed = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : fmtSigned(x, d).replace('−', '-'));
const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
const sep = (n: number) => row(Array.from({ length: n }, () => '---'));

function gradeText(m: Matrix): string {
  const g = m.tps.map((t) => t.grade).filter((x): x is number => x !== null);
  return g.length ? `중학교 ${Math.max(...g)}학년` : '중학생';
}

function tpTable(m: Matrix, tpLabel: (id: string) => string): string {
  const lines = [row(['시점', '유형', '비고']), sep(3)];
  for (const t of m.tps) lines.push(row([tpLabel(t.id), t.kind === 'exam' ? '지필고사' : '학기 성적', t.kind === 'semester' ? '수행평가 등 포함 가능' : '']));
  return lines.join('\n');
}

const COMMON_RULES = `- 아래 데이터는 이름·학번·번호·학급 등 식별 정보를 지운 익명 자료입니다. 개인을 추측하거나 특정하려 하지 마세요.
- 제공된 수치만 근거로 쓰고, 없는 정보(가정환경, 성격 등)를 지어내지 마세요.
- 점수는 원점수(만점 100)입니다. z는 학급 기준 표준화 점수입니다(0 = 학급 평균, +1 = 학급 평균보다 1표준편차 높음).
- '학년 평균'은 학년 전체 응시생 평균입니다. 학년 표준편차는 자료에 없습니다.
- '-'는 결측(응시하지 않았거나 자료 없음)이며 0점이 아닙니다.
- 학기 성적은 수행평가가 포함될 수 있어 지필고사 점수와 측정 기준이 다를 수 있습니다.`;

export function studentPrompt(m: Matrix, ds: Dataset, stu: string, settings: Settings, tpLabel: (id: string) => string): string {
  const items = m.items.filter((i) => i.id !== AVG);
  const avg = studentTrend(m, AVG, stu, 'raw', settings);
  const out: string[] = [];
  out.push(`# 역할
당신은 중학교 성적 데이터를 해석하는 교육 데이터 분석가이자 담임교사의 상담을 돕는 조언자입니다.

# 지켜야 할 점
${COMMON_RULES}

# 데이터 설명
- 대상: ${gradeText(m)} 학생 1명(이하 '대상 학생'), 비교 시점 ${m.tps.length}개
- 공통 과목 평균: 비교한 모든 시점에 있는 과목(${m.common.join(', ') || '없음'})의 평균
- 추세 판단 기준: 첫 시점 대비 마지막 시점 z 변화가 +${settings.trendThreshold} 이상이면 상승, -${settings.trendThreshold} 이하이면 하락

## 시점
${tpTable(m, tpLabel)}

# 데이터`);

  out.push('## 공통 과목 평균 추이');
  out.push(row(['시점', '대상 학생', '학급 평균', '학년 평균', '학급 내 z']));
  out.push(sep(5));
  m.tpIds.forEach((tp) => {
    const c = m.cell(AVG, tp, stu);
    const st = m.stat(AVG, tp);
    out.push(row([tpLabel(tp), plain(c?.raw), plain(st?.mean), plain(st?.gradeMean), signed(c?.z, 2)]));
  });
  out.push(`- 변화: ${signed(avg.delta)}점, z ${signed(avg.deltaZ, 2)} → 추세 '${avg.label}'`);

  out.push('', '## 과목별 원점수 (괄호 안은 학급 내 z)');
  out.push(row(['과목', ...m.tpIds.map(tpLabel)]));
  out.push(sep(m.tpIds.length + 1));
  for (const it of items) {
    out.push(
      row([
        it.label,
        ...m.tpIds.map((tp) => {
          const c = m.cell(it.id, tp, stu);
          return c ? `${plain(c.raw)} (${signed(c.z, 2)})` : '-';
        }),
      ]),
    );
  }

  out.push('', '## 과목별 학급 평균 / 학년 평균');
  out.push(row(['과목', ...m.tpIds.map(tpLabel)]));
  out.push(sep(m.tpIds.length + 1));
  for (const it of items) {
    out.push(
      row([
        it.label,
        ...m.tpIds.map((tp) => {
          const st = m.stat(it.id, tp);
          return st?.n ? `${plain(st.mean)} / ${plain(st.gradeMean)}` : '-';
        }),
      ]),
    );
  }

  out.push(`
# 요청
1. 전체 성적 추세를 3문장 이내로 요약해 주세요(근거 수치 포함).
2. 상대적 강점 과목과 보완이 필요한 과목을 각각 2개 이내로 고르고, 학년 평균·학급 내 z 수치로 근거를 들어 주세요.
3. 변화가 큰 과목(오르거나 내린 과목)과 그 변화를 해석할 때 주의할 점을 알려 주세요.
4. 학생·학부모 상담에서 쓸 수 있는 구체적인 학습 조언 3가지를 제안해 주세요.
5. 이 데이터만으로는 판단하기 어려운 부분과, 상담에서 추가로 확인할 질문 2가지를 적어 주세요.
6. 담임 선생님이 학부모에게 전달할 '선생님 의견'을 250자 이내(공백 포함)로 제안해 주세요.
   - 성적표 안내문의 '선생님 의견' 칸에 그대로 붙여 넣을 수 있는 문장으로, 존댓말을 씁니다.
   - 강점을 먼저 쓰고, 보완할 점과 가정에서 도울 수 있는 방법을 이어서 씁니다.
   - 이름 대신 '학생'이라고 쓰고, 순위나 다른 학생과 비교하는 표현은 쓰지 않습니다.
   - 서로 다른 어조의 안 2개를 제시하고, 각 안 끝에 글자 수를 괄호로 적어 주세요.

# 출력 형식
- 한국어, 소제목과 불릿 사용
- 단정적 표현을 피하고 수치 근거를 함께 제시
- 학생을 낙인찍는 표현 금지`);
  return out.join('\n');
}

/** 학생 순서를 섞어 익명 코드(S01…)를 붙인다. rand는 테스트용으로 바꿀 수 있다. */
export function classPrompt(m: Matrix, ds: Dataset, settings: Settings, tpLabel: (id: string) => string, rand: () => number = Math.random): string {
  const items = m.items.filter((i) => i.id !== AVG);
  const order = [...m.students];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const code = (i: number) => `S${String(i + 1).padStart(2, '0')}`;
  const out: string[] = [];
  out.push(`# 역할
당신은 중학교 학급 단위 성적 데이터를 해석하는 교육 데이터 분석가이자 담임교사의 학급 운영을 돕는 조언자입니다.

# 지켜야 할 점
${COMMON_RULES}
- 학생은 S01, S02… 익명 코드로만 표시하며, 코드 순서는 무작위입니다(출석 번호와 무관).

# 데이터 설명
- 대상: ${gradeText(m)} 한 학급, 학생 수 ${m.students.length}명, 비교 시점 ${m.tps.length}개
- 공통 과목 평균: 비교한 모든 시점에 있는 과목(${m.common.join(', ') || '없음'})의 평균
- 추세 판단 기준: 첫 시점 대비 마지막 시점 z 변화가 +${settings.trendThreshold} 이상이면 상승, -${settings.trendThreshold} 이하이면 하락

## 시점
${tpTable(m, tpLabel)}

# 데이터`);

  out.push('## 시점별 학급 통계 (공통 과목 평균)');
  out.push(row(['시점', '응시 인원', '학급 평균', '표준편차', '중앙값', '최저', '최고', '학년 평균']));
  out.push(sep(8));
  m.tpIds.forEach((tp) => {
    const st = m.stat(AVG, tp);
    out.push(row([tpLabel(tp), st?.n ?? 0, plain(st?.mean), plain(st?.sd), plain(st?.median), plain(st?.min), plain(st?.max), plain(st?.gradeMean)]));
  });

  out.push('', '## 과목별 학급 평균 (괄호 안은 학년 평균)');
  out.push(row(['과목', ...m.tpIds.map(tpLabel)]));
  out.push(sep(m.tpIds.length + 1));
  for (const it of items) {
    out.push(
      row([
        it.label,
        ...m.tpIds.map((tp) => {
          const st = m.stat(it.id, tp);
          return st?.n ? `${plain(st.mean)} (${plain(st.gradeMean)})` : '-';
        }),
      ]),
    );
  }

  out.push('', '## 학생별 공통 과목 평균 추이 (익명 코드, 무작위 순서)');
  out.push(row(['코드', ...m.tpIds.map(tpLabel), '변화', 'z 변화', '추세']));
  out.push(sep(m.tpIds.length + 4));
  order.forEach((s, i) => {
    const t = studentTrend(m, AVG, s, 'raw', settings);
    out.push(row([code(i), ...t.values.map((v) => plain(v)), signed(t.delta), signed(t.deltaZ, 2), t.label]));
  });

  const counts = { 상승: 0, 유지: 0, 하락: 0, '판단 불가': 0 } as Record<string, number>;
  for (const s of m.students) counts[studentTrend(m, AVG, s, 'z', settings).label]++;
  out.push(`- 추세 분포: 상승 ${counts['상승']}명, 유지 ${counts['유지']}명, 하락 ${counts['하락']}명, 판단 불가 ${counts['판단 불가']}명`);

  out.push(`
# 요청
1. 학급 전체의 성적 추세를 3문장 이내로 요약해 주세요(평균·분포 변화 수치 포함).
2. 학년 평균과 비교했을 때 학급이 상대적으로 강한 과목과 약한 과목을 알려 주세요.
3. 분포(표준편차·최저·최고)가 어떻게 바뀌었는지, 격차가 커졌는지 줄었는지 해석해 주세요.
4. 관심이 필요한 학생을 익명 코드로 최대 5명 고르고, 근거 수치와 함께 담임이 할 수 있는 지원 방법을 제안해 주세요.
5. 학급 운영·수업 측면의 실천 제안 3가지와, 이 데이터만으로 판단하기 어려운 점을 적어 주세요.

# 출력 형식
- 한국어, 소제목·표·불릿 사용
- 단정적 표현을 피하고 수치 근거를 함께 제시
- 특정 학생을 낙인찍는 표현 금지`);
  void ds;
  return out.join('\n');
}
