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
  const lines = [], frags = [], lineMeta = [], blocks = [];
  const n = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let segs = [];
    try { segs = pdfSegments(await page.getOperatorList(), lib.OPS); } catch (e) { segs = []; }
    const pageFr = [];
    // y 기준으로 줄 묶기 → x 순 정렬. 가까운 글자는 한 조각(frag)으로, 멀면 표 칸 구분(│)
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
      let row = rows.find(r => Math.abs(r.y - y) < h * 0.45);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width, h, s: it.str.replace(/gfedcb/g, '☑').replace(/gfedc/g, '☐') });
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
        frags.push(runs[k]); pageFr.push(runs[k]);
      }
      if (s) { lines.push(s); lineMeta.push({ p: p - 1, y: r.y }); }
    }
    // 표 선으로 실제 표 만들기
    const startLine = lines.length - lineMeta.filter(m => m.p === p - 1).length;
    for (const b of pdfPageBlocks(pageFr, segs)) {
      let li = startLine;
      for (let k = startLine; k < lines.length; k++) { if (lineMeta[k].y <= b.top + 2) { li = k; break; } li = k; }
      b.line = li; b.p = p - 1;
      blocks.push(b);
    }
    lines.push('<<PAGE>>'); lineMeta.push({ p: p - 1, y: -1e9 });
    page.cleanup();
  }
  await doc.destroy();
  lines.frags = frags;
  lines.blocks = blocks;
  return lines;
}

// 그리기 명령에서 가로·세로 선분 모으기 (표 테두리)
function pdfSegments(opList, OPS) {
  const segs = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const T = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  const add = (a, b) => {
    const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
    if (dy < 1.5 && dx > 3) segs.push({ o: 'h', y: (a[1] + b[1]) / 2, a: Math.min(a[0], b[0]), b: Math.max(a[0], b[0]) });
    else if (dx < 1.5 && dy > 3) segs.push({ o: 'v', x: (a[0] + b[0]) / 2, a: Math.min(a[1], b[1]), b: Math.max(a[1], b[1]) });
  };
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.constructPath) {
      const ops = args[0], co = args[1];
      let j = 0, cur = null, start = null;
      for (const op of ops) {
        if (op === OPS.moveTo) { cur = T(co[j], co[j + 1]); start = cur; j += 2; }
        else if (op === OPS.lineTo) { const nx = T(co[j], co[j + 1]); if (cur) add(cur, nx); cur = nx; j += 2; }
        else if (op === OPS.rectangle) {
          const x = co[j], y = co[j + 1], w = co[j + 2], h = co[j + 3]; j += 4;
          const p1 = T(x, y), p2 = T(x + w, y), p3 = T(x + w, y + h), p4 = T(x, y + h);
          const W = Math.abs(p2[0] - p1[0]) + Math.abs(p2[1] - p1[1]), H = Math.abs(p4[0] - p1[0]) + Math.abs(p4[1] - p1[1]);
          if (W < 2.5 && H > 3) add([(p1[0] + p2[0]) / 2, p1[1]], [(p1[0] + p2[0]) / 2, p4[1]]);
          else if (H < 2.5 && W > 3) add([p1[0], (p1[1] + p4[1]) / 2], [p2[0], (p1[1] + p4[1]) / 2]);
          else { add(p1, p2); add(p2, p3); add(p3, p4); add(p4, p1); }
          cur = p1; start = p1;
        }
        else if (op === OPS.closePath) { if (cur && start) add(cur, start); cur = start; }
        else if (op === OPS.curveTo) { cur = T(co[j + 4], co[j + 5]); j += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur = T(co[j + 2], co[j + 3]); j += 4; }
      }
    }
  }
  return segs;
}

// 선분 → 표(이어진 선분 묶음) → 칸(병합 포함) → 글자 채우기
function pdfPageBlocks(fr, segs) {
  const blocks = [];
  if (segs.length >= 4) {
    // 서로 닿는 선분끼리 묶기
    const par = segs.map((_, i) => i);
    const find = i => (par[i] === i ? i : (par[i] = find(par[i])));
    const H = segs.map((s, i) => [s, i]).filter(([s]) => s.o === 'h'), V = segs.map((s, i) => [s, i]).filter(([s]) => s.o === 'v');
    const tol = 2;
    for (const [h, hi] of H) for (const [v, vi] of V) {
      if (v.x >= h.a - tol && v.x <= h.b + tol && h.y >= v.a - tol && h.y <= v.b + tol) par[find(hi)] = find(vi);
    }
    const groups = new Map();
    segs.forEach((s, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(s); });
    for (const g of groups.values()) {
      const hs = g.filter(s => s.o === 'h'), vs = g.filter(s => s.o === 'v');
      if (hs.length < 2 || vs.length < 2) continue;
      const tb = buildGrid(hs, vs, fr);
      if (tb) blocks.push(tb);
    }
  }
  return blocks.sort((a, b) => b.top - a.top);
}
function clusterVals(vals, tol = 2) {
  const out = [];
  for (const v of [...vals].sort((a, b) => a - b)) { const l = out[out.length - 1]; if (l !== undefined && v - l.v < tol) { l.s += v; l.n++; l.v = l.s / l.n; } else out.push({ v, s: v, n: 1 }); }
  return out.map(o => o.v);
}
function buildGrid(hs, vs, fr) {
  const ys = clusterVals(hs.map(s => s.y)).sort((a, b) => b - a); // 위→아래
  const xs = clusterVals(vs.map(s => s.x));
  if (ys.length < 2 || xs.length < 2) return null;
  const top = ys[0], bottom = ys[ys.length - 1], left = xs[0], right = xs[xs.length - 1];
  if (right - left < 40 || top - bottom < 15) return null;
  const nR = ys.length - 1, nC = xs.length - 1;
  if (nR * nC > 4000) return null;
  // 경계선이 실제로 그어졌는지(덮는 비율)
  const covV = (x, y1, y2) => { let c = 0; for (const s of vs) if (Math.abs(s.x - x) < 2) c += Math.max(0, Math.min(s.b, y1) - Math.max(s.a, y2)); return c / Math.max(1, y1 - y2); };
  const covH = (y, x1, x2) => { let c = 0; for (const s of hs) if (Math.abs(s.y - y) < 2) c += Math.max(0, Math.min(s.b, x2) - Math.max(s.a, x1)); return c / Math.max(1, x2 - x1); };
  const id = (r, c) => r * nC + c;
  const par = Array.from({ length: nR * nC }, (_, i) => i);
  const find = i => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) {
    if (c + 1 < nC && covV(xs[c + 1], ys[r], ys[r + 1]) < 0.5) par[find(id(r, c + 1))] = find(id(r, c));
    if (r + 1 < nR && covH(ys[r + 1], xs[c], xs[c + 1]) < 0.5) par[find(id(r + 1, c))] = find(id(r, c));
  }
  const cells = new Map();
  for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) {
    const k = find(id(r, c));
    const e = cells.get(k) || { r0: r, c0: c, r1: r, c1: c };
    e.r0 = Math.min(e.r0, r); e.c0 = Math.min(e.c0, c); e.r1 = Math.max(e.r1, r); e.c1 = Math.max(e.c1, c);
    cells.set(k, e);
  }
  if (cells.size < 2) return null;
  const list = [...cells.values()].map(e => ({ r: e.r0, c: e.c0, rs: e.r1 - e.r0 + 1, cs: e.c1 - e.c0 + 1, x1: xs[e.c0], x2: xs[e.c1 + 1], y1: ys[e.r0], y2: ys[e.r1 + 1], fs: [] }));
  let inside = 0;
  for (const f of fr) {
    const cx = f.x + f.w / 2, cy = f.y + f.h * 0.3;
    if (cx < left || cx > right || cy > top || cy < bottom) continue;
    const cell = list.find(e => cx >= e.x1 && cx <= e.x2 && cy <= e.y1 && cy >= e.y2);
    if (cell) { cell.fs.push(f); inside++; f.inTable = true; }
  }
  if (!inside) return null;
  for (const e of list) {
    const rows = [];
    for (const f of e.fs.sort((a, b) => b.y - a.y || a.x - b.x)) { const l = rows[rows.length - 1]; if (l && Math.abs(l.y - f.y) < f.h * 0.45) l.t += ' ' + f.s; else rows.push({ y: f.y, t: f.s }); }
    e.lines = rows.map(r => r.t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  // 빈 행·열만 있는 표는 버림
  const filled = list.filter(e => e.lines.length);
  if (filled.length < 2) return null;
  return { type: 'table', top, rows: cellsToRows(list.map(e => ({ r: e.r, c: e.c, rs: e.rs, cs: e.cs, lines: e.lines }))) };
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

// 블록(문단·표) 목록 → 줄 목록(예전 검출과 호환). 표는 칸마다 문단을 줄로 낸다.
function blocksToLines(blocks) {
  const lines = [];
  for (const b of blocks) {
    b.line = lines.length;
    if (b.type === 'p') { if (b.text) lines.push(b.text); }
    else for (const row of b.rows) for (const c of row) for (const l of c.lines) if (l) lines.push(l);
    b.lineEnd = lines.length;
  }
  return lines;
}
// 칸 목록(주소·병합) → 행 배열
function cellsToRows(cells) {
  const rows = [];
  for (const c of cells) { (rows[c.r] || (rows[c.r] = [])).push(c); }
  const out = [];
  for (const r of rows) if (r) out.push(r.sort((a, b) => a.c - b.c).map(c => ({ t: c.lines.join('\n'), r: c.r, c: c.c, cs: c.cs, rs: c.rs, lines: c.lines })));
  return out;
}
const clean = s => String(s || '').replace(/[ \t ]+/g, ' ').trim();

// ---------- HWP 5.0 : 레코드 트리 ----------
function hwpRecords(data) {
  const recs = [];
  let o = 0;
  while (o + 4 <= data.length) {
    const h = u32(data, o); o += 4;
    const tag = h & 0x3ff, level = (h >>> 10) & 0x3ff; let size = (h >>> 20) & 0xfff;
    if (size === 0xfff) { size = u32(data, o); o += 4; }
    recs.push({ tag, level, data: data.subarray(o, o + size), kids: [] });
    o += size;
  }
  // 수준(level)으로 부모-자식 연결
  const root = { tag: -1, level: -1, kids: [] }, st = [root];
  for (const r of recs) {
    while (st.length > 1 && st[st.length - 1].level >= r.level) st.pop();
    st[st.length - 1].kids.push(r); st.push(r);
  }
  return root;
}
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
function hwpCtrlId(d) { return String.fromCharCode(d[3], d[2], d[1], d[0]); }

function hwpWalkParas(nodes, out) {
  for (const n of nodes) if (n.tag === 66) hwpPara(n, out);
}
function hwpPara(p, out) {
  const tx = p.kids.find(k => k.tag === 67);
  const text = tx ? clean(hwpParaText(tx.data)) : '';
  if (text) out.push({ type: 'p', text });
  for (const k of p.kids) {
    if (k.tag !== 71) continue; // CTRL_HEADER
    const id = hwpCtrlId(k.data);
    if (id === 'tbl ') hwpTable(k, out);
    else { // 글상자 등: 안쪽 문단만 꺼낸다
      const paras = []; collectParas(k, paras); hwpWalkParas(paras, out);
    }
  }
}
function collectParas(node, acc) { for (const k of node.kids) { if (k.tag === 66) acc.push(k); else if (k.tag === 71 || k.tag === 72) collectParas(k, acc); } }
function hwpParaPlain(p) {
  // 칸 안 문단 → 글줄들(안쪽 표는 글로 펴기)
  const lines = [];
  const tx = p.kids.find(k => k.tag === 67);
  const t = tx ? clean(hwpParaText(tx.data)) : '';
  if (t) lines.push(t);
  for (const k of p.kids) if (k.tag === 71) { const sub = []; collectParas(k, sub); for (const q of sub) lines.push(...hwpParaPlain(q)); }
  return lines;
}
function hwpTable(ctrl, out) {
  const tb = ctrl.kids.find(k => k.tag === 77);
  const nRows = tb ? u16(tb.data, 4) : 0, nCols = tb ? u16(tb.data, 6) : 0;
  const cells = [];
  let cur = null;
  for (const k of ctrl.kids) {
    if (k.tag === 72) {
      const d = k.data;
      let off = 8;
      const ok = o => d.length >= o + 8 && u16(d, o) < Math.max(nCols, 1) && u16(d, o + 2) < Math.max(nRows, 1) && u16(d, o + 4) >= 1 && u16(d, o + 6) >= 1;
      if (!ok(8) && ok(6)) off = 6;
      cur = { c: u16(d, off), r: u16(d, off + 2), cs: u16(d, off + 4) || 1, rs: u16(d, off + 6) || 1, paras: [], lines: [] };
      cells.push(cur);
    } else if (k.tag === 66 && cur) { cur.paras.push(k); cur.lines.push(...hwpParaPlain(k)); }
  }
  if (cells.length <= 1) { // 테두리용 1칸 표는 풀어서 본문처럼
    if (cells[0]) hwpWalkParas(cells[0].paras, out);
    return;
  }
  for (const c of cells) delete c.paras;
  out.push({ type: 'table', rows: cellsToRows(cells) });
}

function hwpDoc(buf) {
  const cfb = CFB.read(Buffer.from(buf), { type: 'buffer' });
  const header = cfbGet(cfb, 'FileHeader');
  if (!header) throw new Error('HWP 헤더 없음');
  const flags = u32(header.content, 36);
  const compressed = !!(flags & 1), encrypted = !!(flags & 2), distribute = !!(flags & 4);
  if (encrypted) throw new Error('암호가 걸린 HWP');
  if (distribute) throw new Error('배포용 HWP(본문 암호화)');
  const blocks = [];
  for (let i = 0; i < 500; i++) {
    const ent = cfbGet(cfb, `BodyText/Section${i}`);
    if (!ent) break;
    let data = new Uint8Array(ent.content);
    if (compressed) data = fflate.inflateSync(data);
    hwpWalkParas(hwpRecords(data).kids, blocks);
  }
  return { blocks, lines: blocksToLines(blocks) };
}
function hwpLines(buf) { return hwpDoc(buf).lines; }
// 예전 방식: 모든 문단 글을 순서대로 (표 해석이 어긋날 때 대비)
function hwpFlat(buf) {
  const cfb = CFB.read(Buffer.from(buf), { type: 'buffer' });
  const header = cfbGet(cfb, 'FileHeader');
  const compressed = !!(u32(header.content, 36) & 1);
  const lines = [];
  for (let i = 0; i < 500; i++) {
    const ent = cfbGet(cfb, `BodyText/Section${i}`);
    if (!ent) break;
    let data = new Uint8Array(ent.content);
    if (compressed) data = fflate.inflateSync(data);
    let o = 0;
    while (o + 4 <= data.length) {
      const h = u32(data, o); o += 4;
      const tag = h & 0x3ff; let size = (h >>> 20) & 0xfff;
      if (size === 0xfff) { size = u32(data, o); o += 4; }
      if (tag === 67) { const t = clean(hwpParaText(data.subarray(o, o + size))); if (t) lines.push(t); }
      o += size;
    }
  }
  return lines;
}
const chars = ls => ls.reduce((a, l) => a + (l === '<<PAGE>>' ? 0 : l.length), 0);
function safeDoc(doc, flat) {
  // 표 해석본의 글자 수가 평면 추출보다 크게 모자라면 평면 것을 쓰고 표는 버린다
  if (chars(doc.lines) < chars(flat) * 0.9) return { lines: flat, blocks: [], fallback: true };
  return doc;
}

// ---------- HWPX ----------
function xmlUnescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&');
}
function xmlTree(xml) {
  const root = { n: '#', a: '', c: [] }, st = [root];
  const re = /<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) { const top = st[st.length - 1]; if (top.n === 't') top.c.push(xmlUnescape(m[5])); continue; }
    const name = m[2];
    if (m[1] === '/') { for (let i = st.length - 1; i > 0; i--) if (st[i].n === name) { st.length = i; break; } continue; }
    const el = { n: name, a: m[3], c: [] };
    st[st.length - 1].c.push(el);
    if (m[4] !== '/') st.push(el);
  }
  return root;
}
const xattr = (el, k) => { const m = el.a.match(new RegExp('\\b' + k + '="([^"]*)"')); return m ? m[1] : ''; };
const kids = (el, n) => el.c.filter(x => typeof x !== 'string' && x.n === n);
function xText(el, skipTbl) {
  if (typeof el === 'string') return el;
  if (el.n === 'tab' || el.n === 'lineBreak') return ' ';
  if (skipTbl && el.n === 'tbl') return '';
  return el.c.map(x => xText(x, skipTbl)).join('');
}
function xFind(el, n, stopAt, acc = []) { // 바로 아래 단계의 n 요소(같은 이름 중첩은 들어가지 않음)
  for (const x of el.c) { if (typeof x === 'string') continue; if (x.n === n) acc.push(x); else if (!stopAt.includes(x.n)) xFind(x, n, stopAt, acc); }
  return acc;
}
function xWalk(el, out) {
  for (const x of el.c) {
    if (typeof x === 'string') continue;
    if (x.n === 'p') xPara(x, out);
    else if (x.n !== 'tbl') xWalk(x, out);
  }
}
function xPara(p, out) {
  const text = clean(xText(p, true));
  if (text) out.push({ type: 'p', text });
  for (const t of xFind(p, 'tbl', ['tbl'])) xTable(t, out);
}
function xParaLines(p) {
  const lines = [];
  const t = clean(xText(p, true)); if (t) lines.push(t);
  for (const tb of xFind(p, 'tbl', ['tbl'])) for (const tc of xFind(tb, 'tc', ['tbl'])) for (const q of xFind(tc, 'p', ['tbl'])) lines.push(...xParaLines(q));
  return lines;
}
function xTable(tbl, out) {
  const tcs = xFind(tbl, 'tc', ['tbl']);
  if (tcs.length <= 1) { if (tcs[0]) xWalk(tcs[0], out); return; }
  const cells = tcs.map((tc, i) => {
    const ad = xFind(tc, 'cellAddr', ['tbl', 'subList'])[0], sp = xFind(tc, 'cellSpan', ['tbl', 'subList'])[0];
    const lines = [];
    for (const p of xFind(tc, 'p', ['tbl'])) lines.push(...xParaLines(p));
    return { c: ad ? +xattr(ad, 'colAddr') : i, r: ad ? +xattr(ad, 'rowAddr') : 0, cs: sp ? +xattr(sp, 'colSpan') || 1 : 1, rs: sp ? +xattr(sp, 'rowSpan') || 1 : 1, lines };
  });
  out.push({ type: 'table', rows: cellsToRows(cells) });
}
function hwpxDoc(files) {
  const names = Object.keys(files).filter(n => /^Contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => +a.match(/(\d+)\.xml/i)[1] - +b.match(/(\d+)\.xml/i)[1]);
  const blocks = [];
  for (const n of names) xWalk(xmlTree(fflate.strFromU8(files[n])), blocks);
  return { blocks, lines: blocksToLines(blocks) };
}
function hwpxLines(files) { return hwpxDoc(files).lines; }
function hwpxFlat(files) {
  const names = Object.keys(files).filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => +a.match(/(\d+)\.xml/i)[1] - +b.match(/(\d+)\.xml/i)[1]);
  const lines = [];
  for (const n of names) {
    const xml = fflate.strFromU8(files[n]);
    let cur = '', inT = 0, m;
    const re = /<(\/?)hp:(p|t|tab|lineBreak)\b[^>]*?(\/?)>|([^<]+)/g;
    while ((m = re.exec(xml))) {
      if (m[4] !== undefined) { if (inT) cur += xmlUnescape(m[4]); continue; }
      const close = m[1] === '/', tag = m[2], self = m[3] === '/';
      if (tag === 't') { if (self) continue; inT += close ? -1 : 1; if (inT < 0) inT = 0; }
      else if (tag === 'tab' || tag === 'lineBreak') cur += ' ';
      else if (tag === 'p') { const t = clean(cur); if (t) lines.push(t); cur = ''; }
    }
    const t = clean(cur); if (t) lines.push(t);
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
  if (kind === 'pdf') { const lines = await pdfLines(buf); return [{ name, lines, frags: lines.frags, blocks: lines.blocks }]; }
  if (kind === 'hwp') {
    let d; try { d = hwpDoc(buf); } catch (e) { if (/암호|배포용|헤더/.test(e.message)) throw e; d = { lines: [], blocks: [] }; }
    d = safeDoc(d, hwpFlat(buf));
    return [{ name, lines: d.lines, blocks: d.blocks, fallback: d.fallback }];
  }
  if (kind === 'zip' || kind === 'hwpx') {
    const ents = unzipEntries(buf);
    if (ents.some(x => /^Contents\/section\d+\.xml$/i.test(x.name))) {
      const files = {};
      for (const x of ents) if (/^Contents\/section\d+\.xml$/i.test(x.name)) files[x.name] = x.data;
      let d; try { d = hwpxDoc(files); } catch (e) { d = { lines: [], blocks: [] }; }
      d = safeDoc(d, hwpxFlat(files));
      return [{ name, lines: d.lines, blocks: d.blocks, fallback: d.fallback }];
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

module.exports = { extractDocs, pdfLines, hwpLines, hwpxLines, hwpDoc, hwpxDoc, extOf };
