// 첨부파일(PDF/HWP/HWPX/ZIP) → 줄 단위 텍스트
const fflate = require('fflate');
const CFB = require('cfb');

let pdfjsP = null;
function pdfjs() {
  if (!pdfjsP) pdfjsP = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsP;
}

function extOf(name) {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)(?:\s*\([^)]*\))?\s*$/);
  return m ? m[1] : '';
}

function sniff(buf) {
  const b = buf.subarray(0, 8);
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'hwp';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'zip'; // hwpx 도 zip
  return '';
}

// ---------- PDF ----------
async function pdfLines(buf, maxPages = 400) {
  const lib = await pdfjs();
  const opts = { data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, verbosity: 0 };
  if (typeof window === 'undefined') {
    const dir = require('path').dirname(require.resolve('pdfjs-dist/package.json'));
    opts.cMapUrl = dir + '/cmaps/'; opts.cMapPacked = true; opts.standardFontDataUrl = dir + '/standard_fonts/';
  }
  const doc = await lib.getDocument(opts).promise;
  const lines = [], frags = [];
  const n = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // y 기준으로 줄 묶기 → x 순 정렬. 가까운 글자는 한 조각(frag)으로, 멀면 표 칸 구분(│)
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
      let row = rows.find(r => Math.abs(r.y - y) < h * 0.45);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width, h, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      const runs = [];
      let cur = null;
      for (const it of r.items) {
        if (cur) {
          const gap = it.x - (cur.x + cur.w);
          if (gap < it.h * 0.55) {
            if (gap > it.h * 0.15 && !cur.s.endsWith(' ')) cur.s += ' ';
            cur.s += it.s; cur.w = it.x + it.w - cur.x; continue;
          }
          runs.push(cur);
        }
        cur = { p: p - 1, x: it.x, y: r.y, w: it.w, h: it.h, s: it.s };
      }
      if (cur) runs.push(cur);
      let s = '';
      for (let k = 0; k < runs.length; k++) {
        const t = runs[k].s.replace(/\s+/g, ' ').trim();
        runs[k].s = t;
        if (!t) continue;
        if (s) s += (runs[k].x - (runs[k - 1].x + runs[k - 1].w) > runs[k].h * 1.2) ? ' │ ' : ' ';
        s += t;
        frags.push(runs[k]);
      }
      if (s) lines.push(s);
    }
    lines.push('<<PAGE>>');
    page.cleanup();
  }
  await doc.destroy();
  lines.frags = frags;
  return lines;
}

// ---------- HWP 5.0 ----------
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

function hwpParaText(data) {
  // UTF-16LE + 제어문자
  let s = '';
  for (let i = 0; i + 1 < data.length;) {
    const c = data[i] | (data[i + 1] << 8);
    if (c < 32) {
      if ([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31].includes(c)) {
        if (c === 10) s += ' ';
        if (c === 30 || c === 31) s += ' ';
        i += 2;
      } else { // 확장/인라인 제어문자: 8 WCHAR
        if (c === 9) s += ' ';
        i += 16;
      }
    } else { s += String.fromCharCode(c); i += 2; }
  }
  return s;
}

function cfbGet(cfb, name) {
  const i = cfb.FullPaths.findIndex(p => p.toLowerCase().endsWith('/' + name.toLowerCase()));
  return i >= 0 ? cfb.FileIndex[i] : null;
}

function hwpLines(buf) {
  const cfb = CFB.read(Buffer.from(buf), { type: 'buffer' });
  const header = cfbGet(cfb, 'FileHeader');
  if (!header) throw new Error('HWP 헤더 없음');
  const flags = u32(header.content, 36);
  const compressed = !!(flags & 1), encrypted = !!(flags & 2), distribute = !!(flags & 4);
  if (encrypted) throw new Error('암호가 걸린 HWP');
  const lines = [];
  const prefix = distribute ? 'ViewText' : 'BodyText';
  if (distribute) throw new Error('배포용 HWP(본문 암호화)');
  for (let i = 0; i < 500; i++) {
    const ent = cfbGet(cfb, `${prefix}/Section${i}`);
    if (!ent) break;
    let data = ent.content;
    if (compressed) data = fflate.inflateSync(new Uint8Array(data));
    else data = new Uint8Array(data);
    let o = 0;
    while (o + 4 <= data.length) {
      const h = u32(data, o); o += 4;
      const tag = h & 0x3ff; let size = (h >>> 20) & 0xfff;
      if (size === 0xfff) { size = u32(data, o); o += 4; }
      if (tag === 67) { // HWPTAG_PARA_TEXT
        const t = hwpParaText(data.subarray(o, o + size)).replace(/\s+/g, ' ').trim();
        if (t) lines.push(t);
      }
      o += size;
    }
  }
  return lines;
}

// ---------- HWPX ----------
function xmlUnescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&');
}

function hwpxLines(files) {
  const names = Object.keys(files).filter(n => /^Contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => +a.match(/(\d+)\.xml/i)[1] - +b.match(/(\d+)\.xml/i)[1]);
  const lines = [];
  for (const n of names) {
    const xml = fflate.strFromU8(files[n]);
    // 문단(<hp:p>) 단위로 텍스트를 모은다. 표 안 문단은 중첩되지만 텍스트 순서는 유지된다.
    let cur = '';
    const re = /<(\/?)hp:(p|t|tab|lineBreak)\b[^>]*?(\/?)>|([^<]+)/g;
    let m, inT = 0;
    while ((m = re.exec(xml))) {
      if (m[4] !== undefined) { if (inT) cur += xmlUnescape(m[4]); continue; }
      const close = m[1] === '/', tag = m[2], self = m[3] === '/';
      if (tag === 't') { if (self) continue; inT += close ? -1 : 1; if (inT < 0) inT = 0; }
      else if (tag === 'tab' || tag === 'lineBreak') cur += ' ';
      else if (tag === 'p') {
        const t = cur.replace(/\s+/g, ' ').trim();
        if (t) lines.push(t);
        cur = '';
      }
    }
    const t = cur.replace(/\s+/g, ' ').trim();
    if (t) lines.push(t);
  }
  return lines;
}

function decodeZipNameUnused(raw) {
  // fflate 는 파일명을 latin1 로 줄 수 있다 → CP949 재해석
  if (/^[\x00-\x7f]*$/.test(raw)) return raw;
  try {
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0) & 0xff);
    const u = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return u;
  } catch (e) {
    try { return new TextDecoder('euc-kr').decode(Uint8Array.from(raw, c => c.charCodeAt(0) & 0xff)); } catch (e2) { return raw; }
  }
}

// 직접 구현한 zip 풀기: 중앙 디렉터리 순서대로, 파일명은 UTF-8 → 안 되면 CP949
function unzipEntries(buf) {
  const out = [];
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 5 && buf[i + 3] === 6) { e = i; break; }
  }
  if (e < 0) throw new Error('zip 구조 아님');
  const count = buf[e + 10] | (buf[e + 11] << 8);
  let o = u32(buf, e + 16);
  for (let n = 0; n < count && o + 46 <= buf.length; n++) {
    if (u32(buf, o) !== 0x02014b50) break;
    const method = buf[o + 10] | (buf[o + 11] << 8);
    const csize = u32(buf, o + 20);
    const nl = buf[o + 28] | (buf[o + 29] << 8), xl = buf[o + 30] | (buf[o + 31] << 8), cl = buf[o + 32] | (buf[o + 33] << 8);
    const lho = u32(buf, o + 42);
    const name = decodeBytes(buf.subarray(o + 46, o + 46 + nl));
    o += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const lnl = buf[lho + 26] | (buf[lho + 27] << 8), lxl = buf[lho + 28] | (buf[lho + 29] << 8);
    const start = lho + 30 + lnl + lxl;
    out.push({ name, get data() { const raw = buf.subarray(start, start + csize); return method === 8 ? fflate.inflateSync(raw) : method === 0 ? raw : null; } });
  }
  return out;
}
function decodeBytes(b) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return new TextDecoder('euc-kr').decode(b); }
}

// 반환: [{name, lines}] — zip 은 여러 문서가 나올 수 있음
async function extractDocs(buf, name, depth = 0) {
  buf = new Uint8Array(buf);
  const kind = sniff(buf) || extOf(name);
  if (kind === 'pdf') { const lines = await pdfLines(buf); return [{ name, lines, frags: lines.frags }]; }
  if (kind === 'hwp') return [{ name, lines: hwpLines(buf) }];
  if (kind === 'zip' || kind === 'hwpx') {
    const ents = unzipEntries(buf);
    if (ents.some(x => /^Contents\/section\d+\.xml$/i.test(x.name))) {
      const files = {};
      for (const x of ents) if (/^Contents\/section\d+\.xml$/i.test(x.name)) files[x.name] = x.data;
      return [{ name, lines: hwpxLines(files) }];
    }
    if (depth > 1) return [];
    const out = [];
    for (const x of ents) {
      const inner = x.name;
      if (!/\.(pdf|hwp|hwpx)$/i.test(inner) || /__MACOSX/.test(inner)) continue;
      const base = inner.split('/').pop();
      try { out.push(...await extractDocs(x.data, base, depth + 1)); }
      catch (e) { out.push({ name: base, lines: [], error: e.message }); }
    }
    return out;
  }
  throw new Error('지원하지 않는 형식: ' + (extOf(name) || '알 수 없음'));
}

module.exports = { extractDocs, pdfLines, hwpLines, hwpxLines, extOf };
