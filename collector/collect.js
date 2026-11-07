#!/usr/bin/env node
// 학교알리미 평가계획 자동 수집기
// 사용: node collector/collect.js --sido 1200000000 [--level 04] [--budget 330] [--limit 0]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { Client, SIDO } = require('./schoolinfo');
const { extractDocs } = require('./extract');
const { detectCases } = require('./detect');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(ROOT, args.out || 'docs/data');
const RAW = path.join(DATA, 'raw');
const sido = String(args.sido || '');
const level = String(args.level || '04'); // 03 중학교, 04 고등학교
const budgetMin = +(args.budget || 330);
const limitSchools = +(args.limit || 0);
const onlyGugun = args.gugun ? String(args.gugun) : '';
const started = Date.now();

if (!SIDO[sido]) { console.error('시·도 코드를 --sido 로 주세요:', Object.entries(SIDO).map(([k, v]) => `${k}=${v}`).join(', ')); process.exit(1); }
fs.mkdirSync(RAW, { recursive: true });
const rawFile = path.join(RAW, `${sido}-${level}.json.gz`);
const DETAIL = path.join(DATA, 'details', `${sido}-${level}`);
fs.mkdirSync(DETAIL, { recursive: true });
const VERSION = 3;     // 이번 검출 규칙 판
const MIN_VERSION = 2; // 이 판보다 오래된 파일만 다시 처리(표 읽기가 없는 1판)
const detailFile = sid => path.join(DETAIL, `${sid}.json.gz`);
function loadDetail(sid) { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(detailFile(sid))).toString('utf8')); } catch (e) { return { cases: {} }; } }
function saveDetail(sid, d) {
  if (!Object.keys(d.cases).length) { try { fs.unlinkSync(detailFile(sid)); } catch (e) {} return; }
  fs.writeFileSync(detailFile(sid), zlib.gzipSync(Buffer.from(JSON.stringify(d)), { level: 9 }));
}

function load() {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(rawFile)).toString('utf8')); }
  catch (e) { return { sido, sidoName: SIDO[sido], level, schools: {} }; }
}
function save(state) {
  state.updated = new Date().toISOString();
  const tmp = rawFile + '.tmp';
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(state)), { level: 9 }));
  fs.renameSync(tmp, rawFile);
}
const timeUp = () => (Date.now() - started) / 60000 > budgetMin;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function compact(c, ctx, idx) {
  const id = crypto.createHash('sha1').update([ctx.sid, ctx.yc, ctx.seq, ctx.doc, c.subject, idx].join('|')).digest('hex').slice(0, 16);
  return {
    id, sub: c.subject, grp: c.group, cur: c.curriculum, ca: c.curAmbiguous ? 1 : 0,
    g: c.grade, se: c.semester, t: c.tasks, pw: c.perfWeight, ew: c.examWeight,
    st: c.standards, m: c.methods, tg: c.tags, sc: c.score, ev: c.evidence,
    ex: (c.excerpt || '').slice(0, 900), doc: ctx.doc !== ctx.fileName ? ctx.doc : undefined,
    nt: (c.tables || []).length,
  };
}

async function main() {
  const state = load();
  const cli = new Client({ delay: +(args.delay || 350) });
  await cli.init();
  log(`${SIDO[sido]} (${sido}) 학교 목록을 불러옵니다`);

  let gugunList = [{ ADDR_CD_ID: '', ADRCD_ID_LAST_NM: '' }];
  if (!sido.startsWith('36')) gugunList = await cli.sigungu(sido);
  if (onlyGugun) gugunList = gugunList.filter(g => g.ADDR_CD_ID === onlyGugun);

  const schools = [];
  for (const g of gugunList) {
    const list = await cli.schools(level, sido, g.ADDR_CD_ID);
    for (const s of list) schools.push({ sid: s.SHL_IDF_CD, name: s.SHL_NM, district: g.ADRCD_ID_LAST_NM || '' });
  }
  log(`학교 ${schools.length}곳`);
  // 오래전에 확인한 학교부터
  schools.sort((a, b) => ((state.schools[a.sid] || {}).checked || '').localeCompare((state.schools[b.sid] || {}).checked || ''));
  const todo = limitSchools ? schools.slice(0, limitSchools) : schools;

  let nFiles = 0, nNew = 0, nErr = 0, sinceSave = 0;
  for (const s of todo) {
    if (timeUp()) { log('시간 예산 소진 — 다음 실행에서 이어서 합니다'); break; }
    const st = state.schools[s.sid] || (state.schools[s.sid] = { name: s.name, district: s.district, files: {} });
    const detail = loadDetail(s.sid);
    let detailDirty = false;
    st.name = s.name; st.district = s.district;
    try {
      const first = await cli.plan(s.sid, s.name);
      if (!first.opts.length) { st.checked = new Date().toISOString(); st.note = '평가계획 공시 없음'; continue; }
      const latestYear = first.opts[0].slice(0, 4);
      const ycs = first.opts.filter(o => o.startsWith(latestYear));
      const keep = new Set();
      for (const yc of ycs) {
        const plan = yc === first.opts[0] ? first : await cli.plan(s.sid, s.name, yc);
        const form = { ...plan.form, JG_YEAR: yc.slice(0, 4), JG_CHASU: yc.slice(4) };
        const files = plan.files.filter(f => f.section === 1 && !/학업\s*성적\s*관리|성적관리\s*규정/.test(f.name));
        for (const f of files) {
          const key = `${yc}:${f.seq}:${f.name}:${f.size}`;
          keep.add(key);
          nFiles++;
          if (st.files[key] && !st.files[key].err && (st.files[key].v || 1) >= MIN_VERSION) continue;
          if (timeUp()) break;
          const rec = { name: f.name, yc, seq: f.seq, size: f.size, at: new Date().toISOString(), v: VERSION, cases: [] };
          for (const [id, d] of Object.entries(detail.cases)) if (d.k === key) delete detail.cases[id];
          detailDirty = true;
          try {
            const buf = await cli.download(form, f.seq);
            const docs = await extractDocs(buf, f.name);
            let idx = 0;
            for (const d of docs) {
              if (d.error) { rec.warn = (rec.warn || '') + `${d.name}: ${d.error}; `; continue; }
              const cs = detectCases(d.lines, { fileName: d.name, year: +yc.slice(0, 4), chasu: +yc.slice(4) }, d.frags, d.blocks);
              for (const c of cs) {
                const row = compact(c, { sid: s.sid, yc, seq: f.seq, doc: d.name, fileName: f.name }, idx++);
                rec.cases.push(row);
                if (c.tables && c.tables.length) detail.cases[row.id] = { k: key, tb: c.tables };
              }
            }
            if (!rec.cases.length) rec.note = '수행평가 미검출';
            nNew++;
            const nTb = rec.cases.reduce((a, c) => a + (c.nt || 0), 0), fb = docs.some(d => d.fallback);
            log(`${s.name} · ${f.name.slice(0, 50)} → ${rec.cases.length}건 · 표 ${nTb}개${fb ? ' (표 해석 실패→글만)' : ''}`);
          } catch (e) {
            rec.err = String(e.message || e).slice(0, 200);
            nErr++;
            log(`${s.name} · ${f.name.slice(0, 50)} → 오류: ${rec.err}`);
          }
          st.files[key] = rec;
          if (++sinceSave >= 10) { save(state); sinceSave = 0; }
        }
      }
      // 내려간(교체된) 첨부는 정리
      if (!timeUp()) {
        for (const k of Object.keys(st.files)) if (!keep.has(k)) delete st.files[k];
        for (const [id, d] of Object.entries(detail.cases)) if (!keep.has(d.k)) { delete detail.cases[id]; detailDirty = true; }
      }
      if (detailDirty) saveDetail(s.sid, detail);
      st.checked = new Date().toISOString();
      delete st.note;
    } catch (e) {
      st.note = '목록 오류: ' + String(e.message || e).slice(0, 150);
      log(`${s.name} 목록 오류: ${st.note}`);
    }
  }
  // 목록에서 사라진 학교 정리 (전체 실행일 때만)
  if (!limitSchools && !onlyGugun && !timeUp()) { const ids = new Set(schools.map(s => s.sid)); for (const k of Object.keys(state.schools)) if (!ids.has(k)) { delete state.schools[k]; try { fs.unlinkSync(detailFile(k)); } catch (e) {} } }
  save(state);
  // 시간 안에 다 못 끝냈으면 표시 파일을 남겨 다음 실행이 이어서 하게 한다
  const pendingFile = path.join(RAW, `${sido}-${level}.pending`);
  if (timeUp()) fs.writeFileSync(pendingFile, new Date().toISOString()); else { try { fs.unlinkSync(pendingFile); } catch (e) {} }
  log(timeUp() ? '남은 학교가 있어 이어서 수집이 필요합니다' : '이 시·도는 모두 처리했습니다');
  log(`끝: 첨부 ${nFiles}개 중 새로 처리 ${nNew}개, 오류 ${nErr}개, ${((Date.now() - started) / 60000).toFixed(1)}분`);
}

main().catch(e => { console.error(e); process.exit(1); });
