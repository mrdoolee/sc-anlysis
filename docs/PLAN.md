# 성적 추세 분석 웹앱 구현 계획

**Goal:** 로컬 xlsx 성적 파일로 학생·학급 성적 추세를 분석하고 HTML/PDF 리포트를 만드는 오프라인 정적 웹앱.

**Architecture:** 순수 함수 코어(`src/core`: xlsx 읽기 → 형식 파싱 → 데이터셋 → 통계·분석)와 문자열 기반 SVG 차트(`src/charts`), 이를 쓰는 바닐라 TS UI(`src/ui`)와 리포트 빌더(`src/report`).
빌드 후 스크립트가 JS/CSS를 `index.html` 하나에 인라인하고 해시 기반 CSP를 넣는다(`file://`로 열림).

**Tech Stack:** Vite 8, TypeScript, Vitest, fflate(유일한 런타임 의존성), playwright-core(시스템 Edge 사용, 브라우저 다운로드 없음).

**Spec:** `docs/SPEC.md`

## 스택 선택 근거
- **UI 프레임워크 없음(바닐라 TS)**: 화면 수가 적고 상태가 단순하다. 의존성이 적을수록 네트워크·텔레메트리 위험 검토 범위가 줄어든다.
- **xlsx 파서 자체 구현 + fflate**: npm의 `xlsx@0.18.5`는 알려진 취약점이 있고 최신판은 npm 레지스트리 밖에서 배포된다. 필요한 기능(첫 시트, 공유 문자열, 숫자)은 작아서 직접 구현해 감사 범위를 최소화한다.
- **SVG 차트 자체 구현**: 같은 SVG 문자열을 화면·HTML 내보내기·인쇄에 그대로 쓴다. 인라인 style 속성을 쓰지 않으므로 엄격한 CSP와 호환되고, `<title>`로 툴팁을 제공한다. ECharts는 약 1MB이고 인라인 스타일이 필요하다.
- **PDF = 브라우저 인쇄**: 로컬 PDF 라이브러리는 한글 폰트(수 MB)를 임베딩해야 한다. 인쇄 CSS는 시스템 한글 폰트를 그대로 쓴다.

## 전역 제약
- 런타임 원격 요청 0건, 원격 URL 하드코딩 금지(SVG 네임스페이스 제외)
- 실제 `sample_data` 이름·점수를 코드·테스트·문서에 넣지 않음
- 표시 반올림 소수 첫째 자리, 내부 원값

## Review Focus
1. 결시·빈 셀 → 0점이 아니라 결측 (parse 테스트)
2. 동명이인 한 파일 내 → 키 분리 (dataset 테스트)
3. 시점 간 과목 구성 차이 → 공통 과목 평균만 (analysis 테스트)
4. σ=0, n<5 → z 없음 (stats 테스트)
5. 이름에 `<`·`&` → SVG/HTML 이스케이프 (charts 테스트)

## 마일스톤
### M1: xlsx 읽기·형식 파싱
- Files: `src/core/xlsx.ts`, `src/core/parse.ts`, `src/core/types.ts`, `tests/fixtures/fake-data.mjs`, `tests/parse.test.ts`
- Produces: `readXlsx(buf: Uint8Array): Grid`, `parseGrid(grid: Grid, fileName: string): ParsedFile`
- Tests: 고사 5과목·8과목, 세로형(forward-fill, 반복 헤더, 쪽번호, P행, 성취도 전용 섹션, 교양교과, 전입생 결측), 메타 추출, 요약 행 제외

### M2: 데이터셋·통계·분석 (TDD)
- Files: `src/core/stats.ts`, `src/core/dataset.ts`, `src/core/analysis.ts`, `src/core/interpret.ts`, `tests/stats.test.ts`, `tests/analysis.test.ts`
- Produces: `buildDataset(files, settings): Dataset`, `presetTimepoints(ds, preset, opts): string[]`, `buildMatrix(ds, tpIds, unit, settings): Matrix`, `studentTrend`, `classSummary`, `alerts`, `semesterGap`, `integrity`
- Tests: z 합 0, T, 경쟁 순위·PR, 기울기, 공통 과목, 성취도 환산, 40명×20시점×10과목 < 200ms

### M3: SVG 차트
- Files: `src/charts/svg.ts`, `tests/charts.test.ts`
- Produces: `lineChart`, `barChart`, `radarChart`, `heatmap`, `boxPlot`, `scatterChart` → `string`

### M4: UI
- Files: `index.html`, `src/main.ts`, `src/ui/*.ts`, `src/styles.css`
- 흐름: 불러오기 → 데이터 확인 → 분석 → 내보내기 → 설정

### M5: 리포트·내보내기
- Files: `src/report/report.ts`, `tests/report.test.ts`
- Produces: `buildReport(ds, sel, opts): string`(본문), `exportHtmlDocument(body): string`

### M6: 빌드·검증
- Files: `scripts/inline-build.mjs`, `scripts/privacy-check.mjs`, `scripts/make-fake-data.mjs`, `e2e/e2e.mjs`
- 명령: `npm test`, `npm run build`, `npm run privacy`, `npm run e2e`
