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
check('file://로 앱 로드', (await page.locator('h1').textContent())?.includes('성적 추세') ?? false);

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
const tpRows = await page.locator('#tp-table tbody tr').count();
check('시점 5개 인식(P만 있는 학기 제외)', tpRows === 5, `${tpRows}개`);
check('결측 학생 표시', (await page.locator('.miss').count()) > 0);
const sugg = page.locator('[data-action="apply-alias"]');
check('사회→역사 별칭 제안', (await sugg.count()) > 0);
await sugg.first().click();
await page.screenshot({ path: join(out, '02-check.png'), fullPage: true });

// 3. 분석: S1, S2, S3
await page.click('#nav-analyze');
for (const p of ['S1', 'S2', 'S3']) {
  await page.selectOption('#c-preset', p);
  const n = await page.locator('#result-body svg').count();
  const sel = await page.locator('.filters input[data-change="tp-toggle"]:checked').count();
  check(`${p} 학생 화면 차트 표시`, n >= 6, `차트 ${n}개, 시점 ${sel}개`);
  await page.screenshot({ path: join(out, `03-${p}-student.png`), fullPage: true });
}
await page.click('#tab-class');
check('학급 개관 차트', (await page.locator('#result-body svg').count()) >= 6);
await page.screenshot({ path: join(out, '04-class.png'), fullPage: true });
await page.locator('#result-body circle.pt, #result-body path.pt').first().click();
check('산점도 점 클릭 → 학생 상세', await page.locator('#tab-student.active').count() === 1);
await page.selectOption('#c-metric', 'z');
check('z 기준 전환', (await page.locator('#result-body').textContent()).includes('z점수'));
await page.click('label:has(#u-group)');
check('교과군 단위 전환', (await page.locator('#c-focus option').allTextContents()).includes('사회'));
await page.click('#tab-alerts');
await page.click('#tab-gap');
check('학기 성적↔고사 격차', (await page.locator('#result-body table').count()) > 0);
await page.screenshot({ path: join(out, '05-gap.png'), fullPage: true });
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
check('학생 리포트에 교사용 지표(z·석차·백분위) 없음', !/z점수|석차|백분위|Δz/.test(parentText));

// 실명 HTML도 저장 가능
await page.uncheck('#anon');
await page.click('#scope-student');
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-html')]);
await dl2.saveAs(join(out, 'report-student.html'));
check('학생 1명 HTML 저장', readFileSync(join(out, 'report-student.html'), 'utf8').includes('학생01'));

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
