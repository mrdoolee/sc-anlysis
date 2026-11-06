// 리포트 본문과 자체 포함 HTML 문서 생성. 스크립트·외부 참조 없음.
import reportCss from './report.css?raw';
import { esc } from '../charts/svg.ts';
import { PRIVACY_NOTE, alertsSection, classSections, footnotes, type ViewCtx } from '../views/sections.ts';
import { parentReport } from '../views/sections.ts';

export type ExportScope = 'student' | 'selected' | 'all' | 'class';

export interface ReportOptions {
  scope: ExportScope;
  students: string[];
  generatedAt: Date;
  /** 학생별 선생님 의견: null = 칸 없음, undefined = 빈 칸, 문자열 = 입력 내용 */
  commentFor?: (key: string) => string | null | undefined;
}

const dateText = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function pageHeader(ctx: ViewCtx, o: ReportOptions, title: string): string {
  return `<div class="report-head"><span>${esc(title)}</span><span>${esc(ctx.ds.classLabel ?? '')} · 생성일 ${dateText(o.generatedAt)}</span></div>`;
}

const privacy = `<p class="privacy">${esc(PRIVACY_NOTE)}</p>`;

export function buildReportBody(ctx: ViewCtx, o: ReportOptions): string {
  const pages: string[] = [];
  const withClass = o.scope === 'class' || o.scope === 'all';
  if (withClass) {
    pages.push(`<section class="page">${pageHeader(ctx, o, '학급 성적 추세 리포트')}${classSections(ctx)}${alertsSection(ctx)}${footnotes(ctx)}${privacy}</section>`);
  }
  if (o.scope !== 'class')
    for (const s of o.students) pages.push(`<section class="page parent-page">${parentReport(ctx, s, o.generatedAt, { comment: o.commentFor ? o.commentFor(s) : undefined })}</section>`);
  return `<div class="report">${pages.join('')}</div>`;
}

export function exportHtmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="only light">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${reportCss}</style>
</head>
<body class="report-doc">
${body}
</body>
</html>
`;
}
