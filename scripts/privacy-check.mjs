// 개인정보 불변 조건(SPEC P1~P5) 정적 점검. 실제 이름·점수는 출력하지 않고 건수만 보고한다.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function walk(dir, skip = new Set(['node_modules', '.git', 'sample_data'])) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, skip));
    else out.push(p);
  }
  return out;
}

// P1·P2: 빌드 산출물
const distHtml = join(root, 'dist', 'index.html');
if (!existsSync(distHtml)) {
  console.log('FAIL  dist/index.html 없음 — npm run build 먼저 실행');
  process.exit(1);
}
const dist = readFileSync(distHtml, 'utf8');
const distFiles = walk(join(root, 'dist'));
check('dist는 index.html 단일 파일', distFiles.length === 1, distFiles.map((f) => relative(root, f)).join(', '));
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(dist)?.[1] ?? '';
for (const d of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "object-src 'none'", "base-uri 'none'"]) check(`CSP: ${d}`, csp.includes(d));
check('CSP: script-src는 해시만(unsafe-inline 없음)', /script-src( 'sha256-[^']+')+;/.test(csp) && !csp.includes('unsafe'));
check('외부 <script src>/<link href> 없음', !/<script[^>]+src=|<link[^>]+href=/i.test(dist));

const NS = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/XML/1998/namespace', 'http://www.w3.org/2000/xmlns/']);
const urls = (s) => (s.match(/(?:https?|wss?|ftp):\/\/[^\s"'`)<>\\]*/gi) ?? []).filter((u) => !NS.has(u));
const distUrls = urls(dist);
check('dist: 원격 URL 0건(SVG 네임스페이스 제외)', distUrls.length === 0, distUrls.slice(0, 5).join(' '));

const srcFiles = walk(join(root, 'src')).filter((f) => ['.ts', '.css', '.html'].includes(extname(f)));
const srcText = srcFiles.map((f) => [relative(root, f), readFileSync(f, 'utf8')]);
const srcUrls = srcText.flatMap(([f, t]) => urls(t).map((u) => `${f}: ${u}`));
check('src: 원격 URL 0건', srcUrls.length === 0, srcUrls.slice(0, 5).join(' '));

// P1·P3: 네트워크·저장 API
const NET = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|serviceWorker|importScripts|indexedDB|document\.cookie|RTCPeerConnection|navigator\.share/;
const netDist = NET.exec(dist);
check('dist: 네트워크·쿠키·IndexedDB API 사용 0건', !netDist, netDist?.[0] ?? '');
const netSrc = srcText.filter(([, t]) => NET.test(t)).map(([f]) => f);
check('src: 네트워크·쿠키·IndexedDB API 사용 0건', !netSrc.length, netSrc.join(', '));
const consoleSrc = srcText.filter(([, t]) => /\bconsole\./.test(t)).map(([f]) => f);
check('src: console 출력 0건', !consoleSrc.length, consoleSrc.join(', '));
const lsSrc = srcText.filter(([, t]) => /localStorage/.test(t)).map(([f]) => f);
check('src: localStorage는 설정 모듈에서만', lsSrc.length === 1 && lsSrc[0].replace(/\\/g, '/') === 'src/core/settings.ts', lsSrc.join(', '));
const styleAttr = srcText.filter(([, t]) => /\sstyle="/.test(t)).map(([f]) => f);
check('src: 인라인 style 속성 0건(CSP 호환)', !styleAttr.length, styleAttr.join(', '));

// P3: 런타임 의존성
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = Object.keys(pkg.dependencies ?? {});
check('런타임 의존성은 fflate뿐', deps.length === 1 && deps[0] === 'fflate', deps.join(', '));

// P5: 실제 학생 정보가 저장소·산출물에 없는지
const sampleDir = join(root, 'sample_data');
const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
check('.gitignore에 sample_data/', /^sample_data\/?$/m.test(gitignore));
if (existsSync(sampleDir)) {
  const { readXlsx } = await import(pathToFileURL(join(root, 'src/core/xlsx.ts')).href);
  const { parseGrid } = await import(pathToFileURL(join(root, 'src/core/parse.ts')).href);
  const secrets = new Set();
  for (const f of readdirSync(sampleDir).filter((x) => x.endsWith('.xlsx'))) {
    const grid = readXlsx(readFileSync(join(sampleDir, f)));
    for (const row of grid) for (const c of row) {
      const m = typeof c === 'string' ? /사용자명\s*:\s*(\S+)/.exec(c) : null;
      if (m) secrets.add(m[1]);
    }
    for (const tp of parseGrid(grid, f).timepoints)
      for (const r of tp.records) {
        if (r.name.replace(/\s/g, '').length >= 2) secrets.add(r.name.replace(/\s/g, ''));
        if (r.sid) secrets.add(r.sid);
      }
  }
  const files = walk(root, new Set(['node_modules', '.git', 'sample_data'])).filter((f) => !/\.(png|pdf|xlsx)$/i.test(f));
  let hits = 0;
  const hitFiles = new Set();
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    for (const s of secrets)
      if (t.includes(s)) {
        hits++;
        hitFiles.add(relative(root, f));
      }
  }
  check(`실제 이름·학번(${secrets.size}개 항목)이 저장소·산출물에 0건`, hits === 0, hits ? `${hits}건: ${[...hitFiles].join(', ')}` : '');
} else console.log('SKIP  sample_data 없음 — 실제 이름 유출 점검 생략');

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
