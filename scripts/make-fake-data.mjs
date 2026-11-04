// 시연·E2E용 가짜 xlsx 파일을 만든다. 사용: node scripts/make-fake-data.mjs [출력폴더]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeFakeClass, makeLargeClass, writeXlsx } from '../tests/fixtures/fake-data.mjs';

export function writeFakeSet(dir, { large = false } = {}) {
  mkdirSync(dir, { recursive: true });
  const files = large ? makeLargeClass({}) : makeFakeClass({ seed: 11, nStudents: 28, transferNo: 27, absentNo: 5 });
  return files.map((f) => {
    const p = join(dir, f.name);
    writeFileSync(p, writeXlsx(f.grid));
    return p;
  });
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('make-fake-data.mjs')) {
  const out = resolve(process.argv[2] ?? 'fake_data');
  const paths = writeFakeSet(out);
  console.log(`가짜 데이터 ${paths.length}개 생성: ${out}`);
}
