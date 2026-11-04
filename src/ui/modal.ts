// 표시 전용 모달. 앱 상태(state)와 분리되어 있어 열고 닫아도 데이터·입력값에 영향을 주지 않는다.
// 배경 클릭·ESC·✕ 버튼으로 닫히고, 열려 있는 동안 body 스크롤을 막는다.

let lastFocus: HTMLElement | null = null;

const root = () => document.getElementById('modal-root')!;

export function openModal(title: string, body: string, opts: { wide?: boolean; id?: string; subtitle?: string; icon?: string; footer?: string } = {}): void {
  lastFocus = document.activeElement as HTMLElement | null;
  root().innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
    <div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"${opts.id ? ` id="${opts.id}"` : ''}>
      <button type="button" class="modal-close" aria-label="닫기" data-modal-close>✕</button>
      <div class="modal-head">${opts.icon ? `<span class="modal-icon" aria-hidden="true">${opts.icon}</span>` : ''}<div><h2 id="modal-title">${title}</h2>${opts.subtitle ? `<p class="modal-sub">${opts.subtitle}</p>` : ''}</div></div>
      <div class="modal-body">${body}</div>${opts.footer ? `<div class="modal-foot">${opts.footer}</div>` : ''}
    </div>
  </div>`;
  document.body.classList.add('modal-open');
  (root().querySelector('[data-modal-close]') as HTMLElement).focus();
}

export function closeModal(): void {
  if (!root().innerHTML) return;
  root().innerHTML = '';
  document.body.classList.remove('modal-open');
  lastFocus?.focus();
  lastFocus = null;
}

export const isModalOpen = () => !!root().innerHTML;

export function installModalHandlers(): void {
  root().addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-modal-close]') || t.hasAttribute('data-modal-backdrop')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (!isModalOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === 'Tab') {
      // 포커스를 모달 안에 가둔다
      const items = [...root().querySelectorAll<HTMLElement>('a[href], button, summary, [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

/** 제작자 안내(사용자가 직접 누르는 외부 링크만 있음 — 데이터는 보내지 않는다) */
export function openCredit(): void {
  openModal(
    '✨ 제작: 두리쌤',
    `<section class="card credit-card">
      <h3>📌 이용 조건</h3>
      <ul>
        <li>교육 목적으로 자유롭게 사용하실 수 있습니다.</li>
        <li>재배포 시 출처(제작자 표기)를 유지해주세요.</li>
        <li>코드를 임의로 수정한 버전을 다시 배포하지 말아주세요.</li>
        <li>수정이 필요하시면 아래 연락처로 요청해주세요.</li>
      </ul>
    </section>
    <section class="card credit-card">
      <h3>📷 문의</h3>
      <ul>
        <li>Instagram: <a href="https://www.instagram.com/trdoolee" target="_blank" rel="noopener noreferrer">trdoolee</a></li>
        <li>Blog: <a href="https://blog.naver.com/trdoolee" target="_blank" rel="noopener noreferrer">blog.naver.com/trdoolee</a></li>
      </ul>
      <p class="credit-note">간단한 질문 위주로 답변드리며, 답변이 늦어질 수 있습니다.</p>
    </section>`,
    { id: 'credit-modal' },
  );
}

export function openManual(): void {
  openModal(
    '사용 설명서',
    `<div class="manual">
      <section class="card">
        <h3>1. 파일 준비 (나이스)</h3>
        <ul>
          <li><strong>고사 일람표</strong>: [나이스] - [학급담임] - [정기시험조회/통계] - [정기시험조회] - [학급별일람표조회-전체교과목] - [저장] 버튼, <strong>XLS data</strong></li>
          <li><strong>교과학습발달상황</strong>: [나이스] - [학급담임] - [학교생활기록부] - [학생부 항목별 조회] - [교과학습발달상황-교과학습발달상황] - [저장] 버튼, <strong>XLS data</strong></li>
          <li>회차마다 고사 일람표를 받고, 학기 성적은 교과학습발달상황 파일 하나에 여러 학년·학기가 함께 들어 있습니다.</li>
        </ul>
      </section>
      <section class="card">
        <h3>2. 불러오기</h3>
        <ul>
          <li>xlsx 파일을 끌어다 놓거나 '파일 선택'으로 여러 개를 한 번에 고릅니다.</li>
          <li>파일은 업로드되지 않고 이 브라우저 안에서만 읽습니다. 새로고침하거나 창을 닫으면 성적 데이터는 사라집니다.</li>
        </ul>
      </section>
      <section class="card">
        <h3>3. 데이터 확인</h3>
        <ul>
          <li>시점(시험·학기)마다 한 줄 상자가 보입니다. 펼쳐서 이름·유형·학년·학기·회차를 고치고 ▲▼로 순서를 바꿉니다.</li>
          <li>필요 없는 시점(예: 원하지 않는 학년의 학기 성적)은 <strong>제외</strong>합니다. '다시 포함'으로 되돌릴 수 있습니다.</li>
          <li>과목 매핑에서 학년마다 이름이 다른 같은 과목(예: 사회 ↔ 역사)을 묶습니다. 학생 매칭에서 결측·번호 불일치를 확인합니다.</li>
        </ul>
      </section>
      <section class="card">
        <h3>4. 대시보드</h3>
        <p>위에서 아래로 차례대로 고릅니다.</p>
        <ol>
          <li><strong>시점 선택</strong>: 비교할 시험·학기 버튼을 켜고 끕니다('모두 선택/모두 해제').</li>
          <li><strong>분석 과목</strong>: 단위(과목/교과군), 점수 기준(원점수·z·T), 중심 과목을 정하고, 그래프에 표시할 과목을 고릅니다.</li>
          <li><strong>분석 대상</strong>: 학생 분석(학생 선택) / 학급 분석 / 주의 학생 중 하나를 고릅니다.</li>
        </ol>
        <ul>
          <li>학생 분석에서 '과목별 추이'와 '표준화 추이' 그래프는 늘 보이며, 누르면 크게 볼 수 있습니다. 나머지 차트는 접혀 있습니다.</li>
          <li><strong>학급 석차</strong>는 '석차 보기'를 눌러야 보입니다. 학생을 바꾸면 다시 가려집니다(상담 중 노출 방지).</li>
          <li>학급 분석의 학생별 표는 머리글을 눌러 정렬합니다.</li>
          <li><strong>✦ AI 프롬프트</strong>: 지금 보고 있는 학생 또는 학급의 성적을 <strong>익명 데이터</strong>(이름·학번·번호·반 없음, 숫자만)로 정리한 AI 분석 요청문을 만듭니다. 앱은 보내지 않으며, 내용을 확인한 뒤 '복사하기'로 학교에서 허용한 AI 도구에 붙여 넣으세요.</li>
        </ul>
      </section>
      <section class="card">
        <h3>5. 내보내기</h3>
        <ul>
          <li>학생 리포트는 학생·학부모 전달용 A4 1장입니다. 선생님 의견을 넣거나 뺄 수 있고, 이 화면에서 직접 입력할 수 있습니다.</li>
          <li>'HTML 파일로 저장' 또는 '인쇄 / PDF로 저장'(인쇄 창에서 'PDF로 저장', A4, 배율 100%)을 사용합니다.</li>
          <li>내보낸 파일에는 개인정보가 들어 있습니다. 필요하면 '익명화'를 켜세요.</li>
        </ul>
      </section>
      <section class="card">
        <h3>개인정보</h3>
        <ul>
          <li>이 앱은 인터넷에 연결하지 않으며, 성적·이름을 어디에도 보내거나 저장하지 않습니다.</li>
          <li>'데이터 모두 지우기'로 불러온 데이터를 즉시 지울 수 있습니다.</li>
        </ul>
      </section>
    </div>`,
    { wide: true, id: 'manual-modal' },
  );
}

export const SHIELD_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** 개인정보보호 동작 원리 안내 */
export function openPrivacy(): void {
  openModal(
    '개인정보보호 동작 원리',
    `<section class="privacy-box">
      <h3>${SHIELD_ICON}개인정보 외부 유출 ZERO (안전한 로컬 전용 처리)</h3>
      <ul>
        <li><strong>Local In-Memory Processing:</strong> 선생님께서 불러오신 나이스 성적 파일(xlsx)과 학생 이름·학번·점수, 선생님 의견은 오직 이 컴퓨터 브라우저의 메모리(RAM) 안에서만 분석됩니다. 새로고침하거나 창을 닫으면 모두 사라집니다.</li>
        <li><strong>No Network · No Server:</strong> 인터넷 연결 없이 동작합니다. 보안 정책(CSP)으로 외부 서버 연결 자체를 막아 두었으며, 외부 데이터베이스·AI·통계 수집 도구를 쓰지 않습니다. 글꼴도 앱 안에 들어 있습니다.</li>
        <li><strong>No Storage:</strong> 성적과 이름은 브라우저 저장소(쿠키·로컬 저장소 등)에 남기지 않습니다. 저장되는 것은 기준값·과목 묶음 같은 설정뿐입니다.</li>
        <li><strong>100% Client-Side Output:</strong> 그래프, HTML 리포트, PDF 인쇄까지 모든 결과가 외부 서버를 거치지 않고 이 컴퓨터 안에서 만들어집니다.</li>
      </ul>
    </section>
    <p class="privacy-warn">내보낸 HTML·PDF 파일에는 학생 개인정보가 들어 있습니다. 보관과 전달에 유의하고, 필요하면 내보내기에서 '익명화'를 켜 주세요.</p>`,
    {
      id: 'privacy-modal',
      icon: SHIELD_ICON,
      subtitle: '학생 개인정보가 외부로 유출되지 않는 이유',
      footer: '<button type="button" class="button-primary" data-modal-close id="privacy-ok">확인 및 닫기</button>',
    },
  );
}
