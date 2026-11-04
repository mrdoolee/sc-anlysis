// E2E: 빌드된 dist/index.html을 file://로 열어 오프라인 상태에서 전체 흐름을 시연하고,
// 기기 밖으로 나가는 요청이 0건인지 확인한다. 시스템에 설치된 Edge(또는 Chrome)를 사용한다.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFakeSet } from '../scripts/make-fake-data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.e2e-out');
const distHtml = join(root, 'dist', 'index.html');
if (!existsSync(distHtml)) throw new Error('dist/index.html이 없습니다. 먼저 npm run build를 실행하세요.');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const channel = process.env.E2E_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ channel, headless: true });
const context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const requests = [];
const internal = [];
const page = await context.newPage();
// 앱 페이지가 보낸 요청만 센다. edge://·chrome:// 는 브라우저 자체 UI(다운로드 창 등)로 앱과 무관하며 네트워크도 아니다.
context.on('request', (r) => {
  const u = r.url();
  if (/^(edge|chrome|devtools):/.test(u)) internal.push(u);
  else requests.push(u);
});
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const url = pathToFileURL(distHtml).href;
await page.goto(url);
check('file://로 앱 로드', (await page.locator('h1').textContent()) === '몇점' && (await page.title()) === '몇점: 성적 분석 도우미(중학교 학급 담임용)');
check('불러오기: 나이스 다운로드 경로 안내', (await page.locator('.path').count()) === 2 && (await page.locator('.steps-help').textContent()).includes('학급별일람표조회-전체교과목'));
check('지원 형식: 괄호 설명 없음', !/(가로형)|(세로형)/.test(await page.locator('.steps-help').textContent()));

// 사이드바 최상단 개인정보보호 박스 → 안내 모달
const firstBlock = await page.evaluate(() => {
  const foot = document.querySelector('.sidebar-foot');
  const card = document.querySelector('.privacy-card');
  return !!card && foot.lastElementChild === card;
});
check('개인정보 박스가 사이드바 맨 아래', firstBlock);
await page.click('#privacy-btn');
check('개인정보보호 안내 모달', (await page.locator('#privacy-modal[role="dialog"]').count()) === 1 && (await page.locator('#privacy-modal .privacy-box li').count()) >= 3 && (await page.locator('#privacy-ok').textContent()) === '확인 및 닫기');
await page.click('#privacy-ok');
check('확인 및 닫기', (await page.locator('#modal-root .modal').count()) === 0);

// 0. 사용 설명서·제작자 모달(표시 전용, 상태 불변)
await page.click('#manual-btn');
check('사용 설명서 모달', (await page.locator('#manual-modal[role="dialog"][aria-modal="true"]').count()) === 1 && (await page.locator('#manual-modal .card').count()) >= 5);
await page.keyboard.press('Escape');
check('ESC로 모달 닫기', (await page.locator('#modal-root .modal').count()) === 0);

// 1. 불러오기
const files = writeFakeSet(join(out, 'fake'));
await page.setInputFiles('#file-input', files);
await page.waitForSelector('.file-card');
check('가짜 xlsx 4개 불러오기', (await page.locator('.file-card').count()) === 4);
await page.evaluate(() => document.fonts.ready);
check('Pretendard 내장 글꼴 로드', await page.evaluate(() => document.fonts.check('16px Pretendard') && [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Pretendard' && f.status === 'loaded')));
await page.screenshot({ path: join(out, '01-load.png'), fullPage: true });

// 2. 데이터 확인
await page.click('#nav-check');
const tpRows = await page.locator('#tp-list .tp-item').count();
check('시점 5개 인식(P만 있는 학기 제외)', tpRows === 5, `${tpRows}개`);
check('결측 학생 표시', (await page.locator('.miss').count()) > 0);
// 원하지 않는 시점 제외 → 다시 포함
// 한 줄 상자 펼치기/접기
await page.click('#tpo-0');
check('시점 펼치기 → 편집 칸 표시', (await page.locator('#tpe-0 input[data-change="tp-label"]').count()) === 1 && (await page.getAttribute('#tpo-0', 'aria-expanded')) === 'true');
await page.fill('#tpl-0', '작년 1학기');
await page.press('#tpl-0', 'Tab');
check('펼친 상자에서 이름 수정', (await page.locator('#tpo-0 strong').textContent()) === '작년 1학기');
await page.click('#tpo-0');
check('시점 접기', (await page.locator('#tpe-0').count()) === 0);
await page.click('[data-action="tp-reset"]');
const semRow = page.locator('.tp-item', { hasText: '2학년 1학기 성적' });
await semRow.locator('[data-action="tp-exclude"]').click();
const afterEx = await page.locator('#tp-list .tp-item').count();
const exList = await page.locator('.excluded li').allTextContents();
check('시점 제외(2학년 1학기 성적)', afterEx === 4 && exList.length === 1 && exList[0].includes('2학년 1학기 성적'), `${afterEx}개 남음`);
await page.click('#tpin-0');
check('제외한 시점 다시 포함', (await page.locator('#tp-list .tp-item').count()) === 5 && (await page.locator('.excluded').count()) === 0);
const sugg = page.locator('[data-action="apply-alias"]');
check('사회→역사 별칭 제안', (await sugg.count()) > 0);
await sugg.first().click();
await page.screenshot({ path: join(out, '02-check.png'), fullPage: true });

// 3. 대시보드
await page.click('#nav-analyze');
check('시나리오 드롭다운 없음', (await page.locator('#c-preset').count()) === 0);
const selTp = () => page.locator('.filters input[data-change="tp-toggle"]:checked').count();
check('처음엔 모든 시점 선택', (await selTp()) === 5);
await page.click('label:has(#tp-0)');
check('시점 버튼으로 선택 해제', (await selTp()) === 4);
await page.click('#tp-all');
check('모두 선택', (await selTp()) === 5);

// 추이 과목 레이어: 버튼을 눌러도 열린 채 유지
await page.click('#subj-more summary');
await page.click('label:has(#hid-0)');
check('표시 과목 레이어 유지', (await page.locator('#subj-more[open]').count()) === 1 && !(await page.isChecked('#hid-0')));
await page.click('label:has(#hid-0)');

// 늘 보이는 차트 2개 + 나머지는 기본 접힘
const svgCount = () => page.locator('#result-body .chart-svg').count();
check('고정 차트 2개(과목별 추이·표준화 추이)', (await page.locator('#result-body .pin-card').count()) === 2 && (await page.locator('#zoom-stu-lines .pin-title').textContent()) === '과목별 추이 (원점수)' && (await page.locator('#zoom-stu-z .pin-title').textContent()).startsWith('표준화 추이'));
check('나머지 차트 기본 접힘', (await page.locator('#result-body .chart-body').count()) === 0 && (await page.locator('#result-body .chart-box').count()) >= 4);
const pinnedOrder = await page.evaluate(() => {
  const pin = document.querySelector('#result-body .pinned');
  const interp = document.querySelector('#result-body .interpret');
  return !!pin && !!interp && !!(pin.compareDocumentPosition(interp) & Node.DOCUMENT_POSITION_FOLLOWING);
});
check('고정 차트가 해석 위에 있음', pinnedOrder);
await page.screenshot({ path: join(out, '03-student.png'), fullPage: true });

// 크게 보기 모달
await page.click('#zoom-stu-lines');
check('차트 크게 보기 모달', (await page.locator('#zoom-modal .chart-svg').count()) === 1 && (await page.evaluate(() => document.body.classList.contains('modal-open'))));
await page.click('#zoom-modal [data-modal-close]');
check('✕로 닫기 + 스크롤 복구', (await page.locator('#modal-root .modal').count()) === 0 && !(await page.evaluate(() => document.body.classList.contains('modal-open'))));

// 접기/펼치기
const pinnedSvgs = 2;
await page.click('#cb-stu-focus');
await page.selectOption('#c-student', { index: 1 });
check('차트 하나 펼치기(학생 바꿔도 유지)', (await svgCount()) === pinnedSvgs + 1 && (await page.getAttribute('#cb-stu-focus', 'aria-expanded')) === 'true');
await page.click('#charts-expand');
const expanded = await svgCount();
check('차트 모두 펼치기', expanded >= pinnedSvgs + 4, `${expanded}개`);
await page.click('#charts-collapse');
check('차트 모두 접기', (await svgCount()) === pinnedSvgs);
await page.selectOption('#c-student', { index: 0 });

// 석차는 눌러야 보이고, 학생을 바꾸면 다시 가려짐
const bodyText = () => page.locator('#result-body').textContent();
check('석차 기본 숨김', (await page.locator('#rank-toggle').textContent()) === '석차 보기' && !/\d+\/\d+위|백분위 \d/.test(await bodyText()));
await page.click('#rank-toggle');
check('석차 보기 → 표시', /\d+\/28위/.test(await bodyText()));
await page.selectOption('#c-student', { index: 2 });
check('학생 바꾸면 석차 다시 숨김', !/\d+\/\d+위/.test(await bodyText()));
await page.selectOption('#c-student', { index: 0 });

// 제작자 모달: 배경 클릭·ESC·✕로 닫힘, 상태 불변
const before = { view: await page.getAttribute('#nav-analyze', 'aria-current'), stu: await page.inputValue('#c-student'), tps: await selTp() };
await page.click('#credit-link');
const links = await page.locator('#credit-modal a').evaluateAll((as) => as.map((a) => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]));
check('제작자 모달: 카드 2개·링크 새 탭', (await page.locator('#credit-modal .card').count()) === 2 && links.length === 2 && links.every(([, t, r]) => t === '_blank' && r.includes('noopener') && r.includes('noreferrer')) && (await page.getAttribute('#credit-modal [data-modal-close]', 'aria-label')) === '닫기');
await page.mouse.click(5, 5);
check('배경 클릭으로 닫기', (await page.locator('#modal-root .modal').count()) === 0);
await page.click('#credit-link');
await page.keyboard.press('Escape');
const after = { view: await page.getAttribute('#nav-analyze', 'aria-current'), stu: await page.inputValue('#c-student'), tps: await selTp() };
check('모달은 앱 상태에 영향 없음', JSON.stringify(before) === JSON.stringify(after) && (await page.locator('#modal-root .modal').count()) === 0);

await page.click('#tab-class');
check('학급 개관: 차트 기본 접힘', (await page.locator('#result-body .chart-box').count()) >= 6 && (await svgCount()) === 0);
await page.click('#charts-expand');
check('학급 개관 차트 펼침', (await svgCount()) >= 6);
await page.screenshot({ path: join(out, '04-class.png'), fullPage: true });
// 학생별 표 정렬
const colVals = async (col) => {
  const idx = await page.evaluate((c) => [...document.querySelectorAll('#class-table thead th')].findIndex((th) => th.querySelector(`[data-col="${c}"]`)), col);
  return page.evaluate((i) => [...document.querySelectorAll('#class-table tbody tr')].map((tr) => tr.children[i].textContent.trim()), idx);
};
const num = (t) => (t === '–' ? null : Number(t.replace('−', '-').replace('+', '')));
await page.click('#class-table [data-col="delta"]');
let ds = (await colVals('delta')).map(num);
const nonNull = (xs) => xs.filter((x) => x !== null);
const isSorted = (xs, dir) => xs.every((x, i) => i === 0 || (dir === 'desc' ? xs[i - 1] >= x : xs[i - 1] <= x));
check('학생별 표: Δ 내림차순 정렬', isSorted(nonNull(ds), 'desc') && (await page.getAttribute('#class-table th:has([data-col="delta"])', 'aria-sort')) === 'descending');
await page.click('#class-table [data-col="delta"]');
ds = (await colVals('delta')).map(num);
check('학생별 표: 다시 누르면 오름차순', isSorted(nonNull(ds), 'asc'));
await page.click('#class-table [data-col="name"]');
const names = await colVals('name');
check('학생별 표: 학생(번호순) 정렬', names[0] === '학생01' && names[1] === '학생02');
await page.locator('#result-body circle.pt, #result-body path.pt').first().click();
check('산점도 점 클릭 → 학생 상세', await page.locator('#tab-student.active').count() === 1);
await page.selectOption('#c-metric', 'z');
check('z 기준 전환', (await page.locator('#result-body').textContent()).includes('z점수'));
await page.click('label:has(#u-group)');
check('교과군 단위 전환', (await page.locator('#c-focus option').allTextContents()).includes('사회'));
await page.click('#tab-alerts');
check('학기 성적↔고사 탭 없음', (await page.locator('#tab-gap').count()) === 0 && !(await page.locator('.segmented').textContent()).includes('고사'));
await page.click('label:has(#u-subject)');
await page.selectOption('#c-metric', 'raw');

// 4. 내보내기: HTML(익명화)
await page.click('#nav-export');
await page.click('#scope-all');
await page.check('#anon');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-html')]);
const htmlPath = join(out, 'report.html');
await dl.saveAs(htmlPath);
const exported = readFileSync(htmlPath, 'utf8');
const extUrls = (exported.match(/(?:https?|wss?):\/\/[^\s"'<>)]*/g) ?? []).filter((u) => !u.startsWith('http://www.w3.org/'));
check('내보낸 HTML: 외부 URL 0건', extUrls.length === 0, extUrls.slice(0, 3).join(' '));
check('내보낸 HTML: 스크립트 없음', !/<script/i.test(exported));
check('내보낸 HTML: CSP meta', exported.includes("default-src 'none'"));
check('익명화: 실제 이름(학생NN) 없음', !/학생\d{2}/.test(exported) && exported.includes('학생A'));
check('내보낸 HTML: 학급 1쪽 + 학생 28장', (exported.match(/class="page"/g) ?? []).length === 1 && (exported.match(/class="page parent-page"/g) ?? []).length === 28);
const parentText = exported.slice(exported.indexOf('class="page parent-page"'));
check('학생 리포트: 석차·백분위·성취도 없음, 표준화 추이 있음', !/석차|백분위|Δz|성취도/.test(parentText) && (parentText.match(/aria-label="표준화 추이/g) ?? []).length === 28);

// 선생님 의견: 입력하면 미리보기·내보내기에 반영, 끄면 칸 없음
await page.uncheck('#anon');
await page.click('#scope-student');
const longComment = '수학 기초가 탄탄해지고 있습니다. '.repeat(20).slice(0, 250);
await page.fill('#comment-text', longComment);
check('선생님 의견 입력 → 미리보기 반영', (await page.locator('#a4-preview .pr-comment-text').textContent()) === longComment.trim() && (await page.inputValue('#comment-text')).length === 250);
await page.uncheck('#inc-comment');
check('선생님 의견 빼기', (await page.locator('#a4-preview .pr-comment').count()) === 0);
await page.check('#inc-comment');
check('다시 넣으면 입력 내용 유지', (await page.inputValue('#comment-text')) === longComment);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-html')]);
await dl2.saveAs(join(out, 'report-student.html'));
const one = readFileSync(join(out, 'report-student.html'), 'utf8');
check('학생 1명 HTML 저장(의견 포함)', one.includes('학생01') && one.includes('수학 기초가 탄탄해지고'));

// 4-1. 학생 리포트 A4 1장: 선택 학생 3명 → PDF 정확히 3쪽, 각 쪽 내용이 잘리지 않음
async function onePageCheck(label, keys) {
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.click('#scope-selected');
  for (const k of keys) await page.check(`#sel-${k}`);
  await page.click('#btn-print');
  // 인쇄 레이아웃 폭 = A4 210mm − 여백 30mm = 180mm ≈ 680px
  await page.setViewportSize({ width: 680, height: 1000 });
  await page.emulateMedia({ media: 'print' });
  const fit = await page.evaluate(() => [...document.querySelectorAll('#print-root .parent-page')].map((el) => el.scrollHeight - el.clientHeight));
  const file = join(out, `parent-${label}.pdf`);
  await page.pdf({ path: file, format: 'A4', printBackground: true });
  const n = (readFileSync(file).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check(`학생 리포트 A4 1장 (${label})`, n === keys.length && fit.length === keys.length && fit.every((x) => x <= 1), `학생 ${keys.length}명 → ${n}쪽, 넘침(px) ${fit.join(',')}`);
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  for (const k of keys) await page.uncheck(`#sel-${k}`);
}
await page.click('#nav-export');
await onePageCheck('S3 5시점', [0, 4, 26]);
await page.screenshot({ path: join(out, '06-export.png'), fullPage: true });

// 5. 인쇄 → PDF
await page.click('#scope-all');
await page.evaluate(() => {
  window.print = () => {};
});
// 인쇄 미리보기 준비(리포트 생성 + 인쇄 레이아웃 계산)까지의 시간
const t0 = Date.now();
await page.click('#btn-print');
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => document.getElementById('print-root').getBoundingClientRect().height);
const previewMs = Date.now() - t0;
const t1 = Date.now();
await page.pdf({ path: join(out, 'report.pdf'), format: 'A4', printBackground: true });
const pdfMs = Date.now() - t1;
const pdf = readFileSync(join(out, 'report.pdf'));
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
check('학급 전체 인쇄 → PDF', pages >= 29, `${pages}쪽, PDF 기록 ${pdfMs}ms`);
check('인쇄 미리보기 준비 < 5초 (28명)', previewMs < 5000, `${previewMs}ms`);
await page.emulateMedia({ media: 'screen' });
await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

// 6. 성능: 40명 × 20시점 × 10과목
page.once('dialog', (d) => d.accept());
await page.click('#clear-all');
check('데이터 모두 지우기', (await page.locator('.file-card').count()) === 0 && !(await page.locator('#nav-analyze').isEnabled()));
const big = writeFakeSet(join(out, 'large'), { large: true });
await page.setInputFiles('#file-input', big);
await page.waitForSelector('.file-card');
await page.click('#nav-analyze');
const perf = await page.evaluate(() => {
  const sta = window.__sta;
  const times = [];
  for (const p of ['S2', 'S3', 'S1', 'S3']) {
    const t = performance.now();
    sta.setPreset(p);
    times.push(performance.now() - t);
  }
  return times;
});
check('시나리오 전환 < 200ms (40×20×10)', Math.max(...perf) < 200, perf.map((x) => `${x.toFixed(0)}ms`).join(', '));
await page.click('#nav-export');
await page.click('#scope-all');
const pt = await page.evaluate(() => {
  const t = performance.now();
  window.__sta.preparePrint();
  return performance.now() - t;
});
check('학급 전체 인쇄 준비 < 5초 (40명)', pt < 5000, `${pt.toFixed(0)}ms`);
await onePageCheck('20시점·10과목', [0, 39]);

// 7. 개인정보: 요청·콘솔
const external = requests.filter((u) => !/^(file|data|blob):/.test(u));
check('기기 밖 요청 0건', external.length === 0, `앱 요청 ${requests.length}건(file/data/blob), 외부 ${external.length}건 ${external.slice(0, 3).join(' ')} · 브라우저 내부 UI ${internal.length}건 제외`);
check('콘솔 오류·CSP 위반 0건', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
check('localStorage에는 설정만 저장', stored.every(([k, v]) => k === 'sta.settings.v1' && !/학생\d{2}/.test(v ?? '')), stored.map(([k]) => k).join(','));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과 · 스크린샷·리포트: ${out}`);
process.exit(failed.length ? 1 : 0);
