#!/usr/bin/env node
// raw/*.json.gz (시·도별 수집 결과) → 웹앱이 읽는 meta.json + 과목별 파일
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { GROUPS } = require('./subjects');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(ROOT, process.argv[2] || 'docs/data');
const RAW = path.join(DATA, 'raw');
const OUT = path.join(DATA, 'subjects');

const DET = path.join(DATA, 'details');
const PACK = path.join(DATA, 'dpack');
const PER_PACK = 30; // 묶음 하나에 담을 학교 수(파일 수를 줄여 Pages 배포를 빠르게)
const hashSid = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
function readDetail(dk, sid) { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DET, dk, sid + '.json.gz'))).toString('utf8')); } catch (e) { return null; } }
// 채점 기준표의 기준(앞쪽 열) 낱말을 짧게 모아 검색에 쓴다
function rubricWords(dc) {
  const seen = new Set(); const out = [];
  for (const t of (dc && dc.tb) || []) {
    if (t.k !== 'rubric') continue;
    for (const row of t.r || []) for (const [txt, c] of row) {
      if (c > 1) continue;
      const w = String(txt).replace(/\s+/g, ' ').trim();
      if (w.length < 2 || w.length > 30 || /^(평가\s*요소|평가\s*항목|평가\s*기준|채점\s*기준|세부\s*기준|배점|점수|등급|수준|척도|비고|영역|구분)$/.test(w) || /^[\d\s.점%()~-]+$/.test(w) || seen.has(w)) continue;
      seen.add(w); out.push(w);
    }
  }
  return out.join(' ').slice(0, 200);
}
const packs = {}; // dk → { n, buckets: [{sid: detail}] }

const raws = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter(f => f.endsWith('.json.gz')) : [];
const bySubject = new Map();
const regions = {};
let nSchools = 0, nSchoolsWith = 0, nFiles = 0, nFilesWith = 0, nErr = 0, nCases = 0;
const levels = new Set();
let latest = '';

for (const f of raws) {
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW, f))).toString('utf8'));
  levels.add(st.level);
  if ((st.updated || '') > latest) latest = st.updated || '';
  const r = st.sidoName;
  regions[r] = regions[r] || {};
  const dk = `${st.sido}-${st.level}`;
  const sids = Object.keys(st.schools);
  const nb = Math.max(1, Math.ceil(sids.length / PER_PACK));
  packs[dk] = { n: nb, buckets: Array.from({ length: nb }, () => ({})) };
  for (const [sid, s] of Object.entries(st.schools)) {
    nSchools++;
    const det = readDetail(dk, sid);
    if (det && det.cases) packs[dk].buckets[hashSid(sid) % nb][sid] = det.cases;
    let has = false;
    regions[r][s.district || ''] = (regions[r][s.district || ''] || 0);
    for (const fr of Object.values(s.files || {})) {
      nFiles++;
      if (fr.err) { nErr++; continue; }
      if (fr.cases && fr.cases.length) nFilesWith++;
      for (const c of fr.cases || []) {
        has = true; nCases++;
        regions[r][s.district || '']++;
        const row = { ...c, s: s.name, sid, r, d: s.district || '', lv: st.level, yc: fr.yc, fs: fr.seq, fn: fr.name, dk: `${st.sido}-${st.level}` };
        if (!row.doc) delete row.doc;
        const rk = det && det.cases && det.cases[c.id] ? rubricWords(det.cases[c.id]) : '';
        if (rk) row.rk = rk;
        // 띄어쓰기만 다른 학교 지정 과목은 하나로 합친다
        const key = c.grp === '기타' ? 'etc:' + String(c.sub).replace(/[\s·ㆍ_-]/g, '') : c.sub;
        if (!bySubject.has(key)) bySubject.set(key, { grp: c.grp, rows: [], names: {} });
        const b = bySubject.get(key);
        b.names[c.sub] = (b.names[c.sub] || 0) + 1;
        b.rows.push(row);
      }
    }
    if (has) nSchoolsWith++;
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const subjects = [];
const order = g => { const i = GROUPS.indexOf(g); return i < 0 ? 99 : i; };
const sorted = [...bySubject.entries()].sort((a, b) => order(a[1].grp) - order(b[1].grp) || b[1].rows.length - a[1].rows.length);
// 표 정보가 있는 행 수
let nWithTables = 0;
sorted.forEach(([key, v], i) => {
  const name = Object.entries(v.names).sort((a, b) => b[1] - a[1])[0][0];
  for (const r of v.rows) r.sub = name;
  const file = `s${String(i + 1).padStart(3, '0')}.json`;
  v.rows.sort((a, b) => (b.sc || 0) - (a.sc || 0) || a.s.localeCompare(b.s));
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(v.rows));
  const curs = {}; const sem = {};
  for (const r of v.rows) { curs[r.cur || '?'] = (curs[r.cur || '?'] || 0) + 1; sem[r.se || '?'] = (sem[r.se || '?'] || 0) + 1; }
  nWithTables += v.rows.filter(r => r.nt > 0).length;
  subjects.push({ name, group: v.grp, count: v.rows.length, file, curs, sem });
});

fs.rmSync(PACK, { recursive: true, force: true });
fs.mkdirSync(PACK, { recursive: true });
const dpack = {};
let nPack = 0;
for (const [dk, p] of Object.entries(packs)) {
  dpack[dk] = p.n;
  p.buckets.forEach((b, i) => { fs.writeFileSync(path.join(PACK, `${dk}-${i}.json.gz`), zlib.gzipSync(Buffer.from(JSON.stringify(b)), { level: 9 })); nPack++; });
}

const meta = {
  updated: latest || new Date().toISOString(), built: new Date().toISOString(), levels: [...levels],
  counts: { withTables: 0, schools: nSchools, schoolsWithCases: nSchoolsWith, files: nFiles, filesWithCases: nFilesWith, fileErrors: nErr, cases: nCases },
  groups: [...GROUPS, '기타'], subjects, regions, dpack,
};
meta.counts.withTables = nWithTables;
fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta));
console.log(`학교 ${nSchools}곳(사례 있는 학교 ${nSchoolsWith}) · 첨부 ${nFiles}개(오류 ${nErr}) · 사례 ${nCases}건 · 과목 ${subjects.length}개 · 상세 묶음 ${nPack}개`);
