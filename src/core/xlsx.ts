// 최소 xlsx 리더: 첫 번째 시트의 셀 값만 읽는다(공유 문자열, 인라인 문자열, 숫자, 불리언).
import { unzipSync, strFromU8 } from 'fflate';
import type { Cell, Grid } from './types.ts';

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITY[e];
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function textOf(fragment: string): string {
  // 윗주(rPh)는 제외하고 <t> 조각을 모두 이어 붙인다.
  const clean = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

function firstSheetPath(files: Record<string, Uint8Array>): string {
  const wb = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  if (wb && rels) {
    const sheet = /<sheet\b[^>]*>/.exec(strFromU8(wb));
    const rid = sheet ? attr(sheet[0], 'r:id') : null;
    if (rid) {
      for (const m of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
        if (attr(m[0], 'Id') === rid) {
          const target = attr(m[0], 'Target') ?? '';
          const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
          if (files[path]) return path;
        }
      }
    }
  }
  const any = Object.keys(files).filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort();
  if (!any.length) throw new Error('xlsx 파일에서 시트를 찾을 수 없습니다.');
  return any[0];
}

export function readXlsx(buf: Uint8Array): Grid {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, { filter: (f) => f.name.startsWith('xl/') });
  } catch {
    throw new Error('xlsx 형식이 아닙니다(압축 해제 실패). .xls 파일은 Excel에서 .xlsx로 저장한 뒤 불러오세요.');
  }
  const shared: string[] = [];
  const sst = files['xl/sharedStrings.xml'];
  if (sst) for (const m of strFromU8(sst).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const xml = strFromU8(files[firstSheetPath(files)]);
  const grid: Grid = [];
  let width = 0;
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const body = m[2];
    const ref = attr(attrs, 'r');
    if (!ref || body === undefined) continue;
    const t = attr(attrs, 't');
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let value: Cell = null;
    if (t === 's') value = v !== undefined ? (shared[Number(v)] ?? null) : null;
    else if (t === 'inlineStr') value = textOf(body);
    else if (t === 'str') value = v !== undefined ? decodeXml(v) : null;
    else if (t === 'e') value = null;
    else if (v !== undefined) {
      const n = Number(v);
      value = Number.isFinite(n) ? n : decodeXml(v);
    }
    if (value === null) continue;
    const row = Number(/\d+/.exec(ref)?.[0] ?? 0) - 1;
    const col = colIndex(ref);
    if (row < 0 || col < 0) continue;
    while (grid.length <= row) grid.push([]);
    grid[row][col] = value;
    width = Math.max(width, col + 1);
  }
  for (const r of grid) {
    for (let c = 0; c < width; c++) if (r[c] === undefined) r[c] = null;
  }
  return grid;
}
