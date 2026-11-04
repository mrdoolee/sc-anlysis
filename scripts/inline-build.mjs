// vite build 결과를 index.html 하나로 합치고(JS·CSS 인라인) 해시 기반 CSP meta를 넣는다.
// 결과물은 file://로 바로 열 수 있고, 외부 리소스를 전혀 불러오지 않는다.
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const htmlPath = join(dist, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

const scriptHashes = [];
const styleHashes = [];

html = html.replace(/<script\b[^>]*\bsrc="\.?\/?([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const code = readFileSync(join(dist, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  scriptHashes.push(sha(code));
  return `<script type="module">${code}</script>`;
});
html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="\.?\/?([^"]+)"[^>]*>/g, (_, href) => {
  const css = readFileSync(join(dist, href), 'utf8').replace(/<\/style/gi, '<\\/style');
  styleHashes.push(sha(css));
  return `<style>${css}</style>`;
});
if (!scriptHashes.length) throw new Error('인라인할 스크립트를 찾지 못했습니다.');

const csp = [
  "default-src 'none'",
  `script-src ${scriptHashes.join(' ')}`,
  `style-src ${styleHashes.join(' ') || "'none'"}`,
  "img-src 'self' data: blob:",
  "connect-src 'none'",
  "font-src data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
].join('; ');
html = html.replace(/<meta charset="utf-8"\s*\/?>/i, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
if (!html.includes('Content-Security-Policy')) throw new Error('CSP meta를 넣지 못했습니다.');

writeFileSync(htmlPath, html);
if (existsSync(join(dist, 'assets'))) rmSync(join(dist, 'assets'), { recursive: true, force: true });
console.log(`dist/index.html 단일 파일 생성 (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB), CSP 적용`);
