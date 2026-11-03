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
  for (const [sid, s] of Object.entries(st.schools)) {
    nSchools++;
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
        if (!bySubject.has(c.sub)) bySubject.set(c.sub, { grp: c.grp, rows: [] });
        bySubject.get(c.sub).rows.push(row);
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
sorted.forEach(([name, v], i) => {
  const file = `s${String(i + 1).padStart(3, '0')}.json`;
  v.rows.sort((a, b) => (b.sc || 0) - (a.sc || 0) || a.s.localeCompare(b.s));
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(v.rows));
  const curs = {}; const sem = {};
  for (const r of v.rows) { curs[r.cur || '?'] = (curs[r.cur || '?'] || 0) + 1; sem[r.se || '?'] = (sem[r.se || '?'] || 0) + 1; }
  subjects.push({ name, group: v.grp, count: v.rows.length, file, curs, sem });
});

const meta = {
  updated: latest || new Date().toISOString(), built: new Date().toISOString(), levels: [...levels],
  counts: { schools: nSchools, schoolsWithCases: nSchoolsWith, files: nFiles, filesWithCases: nFilesWith, fileErrors: nErr, cases: nCases },
  groups: [...GROUPS, '기타'], subjects, regions,
};
fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta));
console.log(`학교 ${nSchools}곳(사례 있는 학교 ${nSchoolsWith}) · 첨부 ${nFiles}개(오류 ${nErr}) · 사례 ${nCases}건 · 과목 ${subjects.length}개`);
