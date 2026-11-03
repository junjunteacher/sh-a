// 줄 단위 텍스트 → 과목별 수행평가 사례 검출 (규칙 기반)
const { normName, findSubject, curriculumOf } = require('./subjects');

const NS = s => String(s).replace(/\s+/g, '');
// 과제(활동)다운 말 — 표 하나에서 뽑은 이름들이 전부 이런 말이 없으면 '내용 영역(단원)' 표로 보고 버린다
const ACTIVITY = /(하기|쓰기|읽기|듣기|말하기|활동|보고서|발표|탐구|실험|프로젝트|토론|토의|제작|작성|감상|분석|조사|포트폴리오|글쓰기|설계|실습|관찰|논술|서술|구술|암송|실기|연주|가창|창작|에세이|만들기|풀이|과제|면접|스피치|회화|인터뷰|캠페인|신문|일지|노트|소논문|리포트|체력|스포츠|경기|배구|야구|축구|농구|배드민턴|탁구|육상|체조|수영|무용|댄스|줄넘기|디자인|공예|드로잉|그리기|표현|비평|독서|퀴즈|게임|코딩|프로그래밍|증명|모델링|어휘|문법|받아쓰기|역할극|상황극|공연|합창|합주|시연|수행|재구성|요약|번역|해석|정리|기록|계획|제안|설명|소개|비교|추론|해결|판단|논증|활용|적용|평가|훈련|응급|소생술|탐색|체험|실천|암기|낭독|낭송|토의|모의|검사|측정|관람|제작|촬영|편집)/;
// 표에서 뽑은 이름은 활동을 나타내는 말이 있어야 남긴다(단원·내용 영역 이름 거르기)
function keepBlock(names) { return names.filter(n => ACTIVITY.test(NS(n))); }

// ---- 과목 구간 나누기 ----
const HEADER_HINT = /(교수.?학습|평가.?(운영)?.?계획|운영.?계획|평가계획|교과.?(목)?.?명|과목.?명|과목코드|교과협의|평가.?세부)/;
const SUBJECT_LABEL = /^(과목|과목명|교과목|교과\(목\)|교과목명|교과\(과목\)|과목\(교과\))[:：]?$/;

function findHeaders(lines) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const n = normName(raw);
    if (!n || n.length > 90) continue;
    let subj = null;
    const br = raw.trim().match(/^[\[<【「]\s*([^\]>】」]{1,25}?)\s*[\]>】」]/);
    if (HEADER_HINT.test(NS(raw))) {
      subj = findSubject(n);
    } else if (br) {
      const s2 = findSubject(normName(br[1]));
      if (s2 && s2.norm === normName(br[1])) subj = s2;
    } else if (SUBJECT_LABEL.test(NS(raw).replace(/[│|]/g, '')) && i + 1 < lines.length) {
      const nn = normName(lines[i + 1]);
      if (nn.length <= 20) subj = findSubject(nn);
    } else {
      const m = NS(raw).match(/^(?:과목|과목명|교과목|교과목명)[:：│|](.{2,20})$/);
      if (m) subj = findSubject(normName(m[1]));
    }
    if (subj) heads.push({ i, subj });
  }
  return heads;
}

function splitSubjects(lines, fileSubject) {
  const heads = findHeaders(lines);
  const segs = [];
  if (!heads.length) {
    if (fileSubject) segs.push({ subj: fileSubject, start: 0, end: lines.length });
    return segs;
  }
  // 같은 과목이 이어지면(머리글 반복) 한 구간으로 합친다
  for (const h of heads) {
    const last = segs[segs.length - 1];
    if (last && last.subj === h.subj) continue;
    if (last) last.end = h.i;
    segs.push({ subj: h.subj, start: h.i, end: lines.length });
  }
  // 첫 머리글 앞부분은 파일 과목이 있으면 붙인다
  if (fileSubject && heads[0].i > 30 && segs[0].subj !== fileSubject) segs.unshift({ subj: fileSubject, start: 0, end: heads[0].i });
  return segs;
}

// ---- 수행평가 영역명 뽑기 ----
const ENDINGS = /(하기|쓰기|읽기|듣기|말하기|만들기|그리기|부르기|활동|보고서|발표|탐구|실험|프로젝트|토론|토의|제작|작성|감상|감상문|분석|조사|포트폴리오|글쓰기|설계|구상|실습|관찰|탐색|표현|해결|논술|서술|구술|면접|과제|기록|정리|비평|독서|체험|연주|가창|실기|측정|창작|영상|캠페인|평가서|일지|노트|신문|카드뉴스|에세이|소논문|리포트|문제해결|실천|수행|대회|경기|게임|퀴즈|산출물|작품|해석|추론|모델링|시뮬레이션|코딩|프로그래밍|회화|스피치|인터뷰|기사|계획서|토의하기|학습지|활동지|평가|논증|증명|풀이|상황극|역할극|PBL|UCC)$/;
const STOP = /^(평가유형|평가방법|평가방식|평가시기|시기|영역만점|만점|영역별|반영비율|영역별반영비율|서술·?논술형반영비율|관련성취기준|성취기준|성취기준코드|관련성취기준코드|평가요소|평가내용|배점|채점기준|기본점수|합계|계|비고|횟수|평가기준|수행평가세부기준|세부평가기준|평가도구)/;
const SKIP = /^(\(?\d+차\)?|\d+차\(\d+(\.\d+)?%\)|\(\d+(\.\d+)?%\)|\d+(\.\d+)?%|\d+(\.\d+)?점|정기시험|지필평가|지필|수행평가|수행|영역·?횟수|영역명?|평가영역|선택형|단답형|서술·?논술형|서술형|논술형|구술형|구술·?발표|및|-|─|│|\||[①-⑩]|[가-하]\.|\d+\.|\d+\)|과목|학기|학년|100%|\d+회|1회|2회|서술·?|논술|구술형및|구술형|선택형단답형|단답형서술·?논술형|선택형·?단답형|합계|계|\(?\d+회\)?|\(?수시\)?|\([\d.%\/회~]+\))$/;
const NOT_NAME = /^(정기시험|지필평가|수행평가|합계|선택형|단답형|서술형|논술형|서술·논술형|구술형|평가유형|반영비율|영역만점|평가방법|평가영역|평가요소|교과협의회|성취기준|학업성적관리위원회|학업성적관리규정|교육과정|평가기준|채점기준|상|중|하|기타|해당없음|없음|미실시|과정중심평가|수업·평가연계|교사관찰|자기평가|동료평가|관찰평가|체크리스트)$/;

function cleanName(s) {
  let t = String(s)
    .replace(/[│|]/g, ' ')
    .replace(/^[\s▪■□◦○●◎◆◇▶▷►•·ㆍ・∙‧\-–—*※☞]+/, '')
    .replace(/^(?:[가-하]\.|\d+\)|\(\d+\)|[①-⑩]|\d+\.(?!\d)|수행\s*평가\s*\d*\s*[:：)]|\[[^\]]{0,10}수행[^\]]*\])\s*/, '')
    .replace(/^\([\d.%\/회~\s]+\)\s*/, '')
    .replace(/\s*[①-⑩☞].*$/, '')
    .replace(/\s*\(\s*\d+(\.\d+)?\s*(점|%)[^)]*\)\s*$/, '')
    .replace(/\s*\d+(\.\d+)?\s*%\s*$/, '')
    .replace(/\s*\(\s*\d+\s*회\s*\)\s*$/, '')
    .replace(/[\s,，、]+$/, '')
    .replace(/(\s*(서술\s*[·ㆍ‧]?\s*(논술형?)?|구술형\s*및|구술형|선택형|단답형|논술형|실기\s*평가)[,，]?)+\s*$/, '')
    .replace(/[\s,，、]+$/, '')
    .replace(/\s+기타$/, '')
    .replace(/\s+/g, ' ').trim();
  // PDF 글자 사이 공백(예: "수 행평가") 정리: 한 글자짜리 토큰이 연달아 나오면 붙인다
  t = t.replace(/(?:^|\s)((?:[가-힣]\s){2,}[가-힣])(?=\s|$)/g, m => ' ' + m.replace(/\s/g, '')).trim();
  return t;
}

function validName(t) {
  const n = NS(t);
  if (n.length < 3 || n.length > 48) return false;
  if ((n.match(/[가-힣]/g) || []).length < 2) return false;
  if (NOT_NAME.test(n)) return false;
  if (/^\[?\d{1,2}[가-힣]/.test(n) && /\d{2}-\d{2}\]?/.test(n)) return false; // 성취기준 코드
  if (/^\d+월|^\d+주|^\d+\/\d+|학년도|교수.?학습|운영.?계획|학업성적/.test(n)) return false;
  if (/(한다|있다|된다|이다|않는다|평가한다|실시한다|함|임)\.?$/.test(n)) return false;
  if (/단원\)|^\(?단원|^\(|성취수준|최소\s*능력|분할|산출방식|유의사항|교육과정적용|^\[/.test(n)) return false;
  if (/[◦※§•㉮㉯㉰㉱㉲㉳]/.test(t)) return false;
  if (/\[\d{1,2}[가-힣]/.test(n) || /^[ⅠⅡⅢⅣⅤⅥ]+\.|^[IVX]+\./.test(n)) return false; // 성취기준 코드·단원 번호
  if (n.length > 42) return false;
  if (!/\s/.test(t.trim()) && /[의을를이가은는에과와로]$/.test(n) && n.length <= 6) return false; // "사이의" 같은 조각
  if (/비율$|^서·?논술형|^서논/.test(n)) return false;
  if (/^\d{1,2}\s/.test(t.trim()) || /다\.?$/.test(n) || /가진다|수있다|할수|판단근거|하위항목|일반적특성/.test(n)) return false;
  if ((n.match(/\[/g) || []).length !== (n.match(/\]/g) || []).length) return false;
  if ((n.match(/\(/g) || []).length !== (n.match(/\)/g) || []).length) return false;
  if (/수행평가|까지$|부터|이의신청|결시|미제출|감점|기본점수|인정점|공개|성적처리|반영비율|정기시험|지필/.test(n)) return false;
  if (/[▪■□●○]/.test(t) || (t.match(/[│|;]/g) || []).length) return false;
  return true;
}

const TABLE_HEAD = /^(영역[·\/]?횟수|평가영역명?|수행평가영역명?|영역명?|수행평가명|평가명|과제명|수행과제)(?![가-힣])/;
const BAND_STOP = /^(평가유형|평가방법|평가방식|반영|영역별|만점|영역만점|시기|평가시기|관련|성취기준|평가요소|평가내용|배점|횟수|서술·?논술형|기본점수|평가기준|채점)/;

// PDF: 좌표 조각으로 표의 "영역" 줄 오른쪽 칸들을 세로로 이어 붙인다
function namesFromPdfTable(frags, pFrom, pTo) {
  const out = [];
  const pageFr = new Map();
  for (const f of frags) { if (f.p < pFrom || f.p > pTo) continue; if (!pageFr.has(f.p)) pageFr.set(f.p, []); pageFr.get(f.p).push(f); }
  for (const [, fs] of pageFr) {
    for (const H of fs) {
      const hn = NS(H.s);
      if (!TABLE_HEAD.test(hn) || hn.length > 12 || /단원/.test(hn)) continue;
      const h = H.h, inLabel = f => f.x < H.x + H.w + h && f.x + f.w > H.x - h;
      const below = fs.filter(f => f !== H && inLabel(f) && f.y < H.y - h * 0.3).sort((a, b) => b.y - a.y);
      const above = fs.filter(f => f !== H && inLabel(f) && f.y > H.y + h * 0.3).sort((a, b) => a.y - b.y);
      const stop = below.find(f => BAND_STOP.test(NS(f.s)));
      if (!stop || H.y - stop.y > h * 14) continue; // 표가 아닌 본문 속 "영역"은 건너뜀
      const bottomY = stop ? stop.y + h * 0.5 : H.y - h * 6;
      const topY = above.length && above[0].y - H.y < h * 8 ? above[0].y - h * 0.4 : H.y + h * 4;
      const cand = fs.filter(f => f.y > bottomY && f.y < topY && f.x >= H.x + H.w - 1 && !SKIP.test(NS(f.s)) && !/^[\d.\s%()점차]+$/.test(f.s));
      // 가로로 겹치는 조각끼리 한 칸으로 묶기
      const cl = [];
      for (const f of cand.sort((a, b) => a.x - b.x)) {
        const c = cl.find(c => f.x < c.x2 + h * 0.3 && f.x + f.w > c.x1 - h * 0.3);
        if (c) { c.items.push(f); c.x1 = Math.min(c.x1, f.x); c.x2 = Math.max(c.x2, f.x + f.w); }
        else cl.push({ x1: f.x, x2: f.x + f.w, items: [f] });
      }
      const blockA = [];
      for (const c of cl) {
        const t = cleanName(c.items.sort((a, b) => b.y - a.y).map(f => f.s).join(' '));
        if (validName(t)) blockA.push(t);
      }
      out.push(...keepBlock(blockA));
    }
    // 방법 B: "지필 | 수행평가 | 합계" 머리 행에서 수행평가 열 아래 칸 읽기
    for (const F of fs) {
      const fn = NS(F.s);
      if (!/^수행평가(\(?\d+(\.\d+)?%\)?)?$/.test(fn)) continue;
      const h = F.h;
      const row = fs.filter(f => Math.abs(f.y - F.y) < h * 0.6).sort((a, b) => a.x - b.x);
      const k = row.indexOf(F);
      if (!row.slice(0, k).some(f => /지필|정기시험|정기고사/.test(NS(f.s)))) continue;
      const prev = row[k - 1], next = row[k + 1];
      const x1 = prev ? prev.x + prev.w + h * 0.2 : F.x - h * 6;
      const x2 = next ? next.x - h * 0.2 : F.x + F.w + h * 30;
      const below = fs.filter(f => f.y < F.y - h * 0.4 && f.y > F.y - h * 12 && f.x + f.w > x1 && f.x < x2).sort((a, b) => b.y - a.y);
      const cand = [];
      let stopY = -Infinity;
      for (const f of below) {
        const n = NS(f.s);
        if (/^(선택형|단답형|서술|논술|구술|만점|영역만점|평가유형|\d+점|\(?\d+(\.\d+)?%\)?|시기|\d+월)/.test(n)) { stopY = f.y + h * 0.3; break; }
      }
      for (const f of below) {
        if (f.y <= stopY) continue;
        const n = NS(f.s);
        if (SKIP.test(n) || /^[\d.\s%()점차]+$/.test(f.s) || /^\d+차/.test(n)) continue;
        cand.push(f);
      }
      const cl = [];
      for (const f of cand.sort((a, b) => a.x - b.x)) {
        const c = cl.find(c => f.x < c.x2 + h * 0.3 && f.x + f.w > c.x1 - h * 0.3);
        if (c) { c.items.push(f); c.x1 = Math.min(c.x1, f.x); c.x2 = Math.max(c.x2, f.x + f.w); }
        else cl.push({ x1: f.x, x2: f.x + f.w, items: [f] });
      }
      const blockB = [];
      for (const c of cl) {
        const t = cleanName(c.items.sort((a, b) => b.y - a.y).map(f => f.s).join(' '));
        if (validName(t)) blockB.push(t);
      }
      out.push(...keepBlock(blockB));
    }
  }
  return out;
}

// 표에서 "영역" 머리 뒤에 오는 칸들을 모아 이름으로 합친다
function namesFromTable(lines, from, to) {
  const out = [];
  for (let i = from; i < to; i++) {
    const n = NS(lines[i]).replace(/[│|]/g, '');
    if (!TABLE_HEAD.test(n) || /단원/.test(n)) continue;
    if (n.length > 40) continue;
    let buf = [], got = 0;
    const block = [];
    for (let j = i + 1; j < Math.min(to, i + 40); j++) {
      const raw = lines[j];
      const nj = NS(raw).replace(/[│|]/g, '');
      if (raw === '<<PAGE>>') continue;
      if (STOP.test(nj)) break;
      const parts = raw.split(/\s*│\s*/).filter(Boolean);
      for (const p of parts) {
        const np = NS(p);
        if (SKIP.test(np) || /^\d+(\.\d+)?$/.test(np)) { if (buf.length) { flush(); } continue; }
        buf.push(p);
        const cont = /(의|을|를|와|과|및|에|에서|으로|로|한|하는|위한|통한|대한|관한|,|·)$/.test(np) || np.length <= 3;
        if (ENDINGS.test(np) || /\(\d+회\)$|\(수시\)$/.test(np) || NS(buf.join('')).length > 30 || !cont) flush();
      }
    }
    if (buf.length) flush();
    out.push(...keepBlock(block));
    function flush() {
      const t = cleanName(buf.join(' '));
      buf = [];
      if (validName(t)) { block.push(t); got++; }
    }
  }
  return out;
}

const PAT_POINTS = /^(?:[▪■□◦○●•\-*]\s*)?(?:[가-하]\.|\d+\)|\(\d+\)|[①-⑩])?\s*(.{2,45}?)\s*\(\s*\d+\s*점\s*[,，/]\s*\d+(?:\.\d+)?\s*%\s*\)/;
const PAT_LABEL = /(?:수행\s*평가\s*\d*|수행\s*과제|과제명|평가\s*영역명?|영역명)\s*[:：]\s*(.{2,50})/;
const PAT_PAREN = /\(\s*[^()]{0,15}수\s*행\s*평\s*가\s*\d*\s*\)\s*(.{3,60})/;

function namesFromPatterns(lines, from, to, isPdf) {
  const out = [];
  for (let i = from; i < to; i++) {
    const l = lines[i];
    let m;
    if ((m = l.match(PAT_POINTS))) out.push(cleanName(m[1]));
    if ((m = l.match(PAT_LABEL))) out.push(cleanName(m[1]));
    if (!isPdf && (m = l.match(PAT_PAREN))) {
      // 다음 줄로 이어지는 경우 붙이기
      let t = m[1];
      if (!ENDINGS.test(NS(cleanName(t))) && i + 1 < to && NS(lines[i + 1]).length < 25) t += ' ' + lines[i + 1];
      out.push(cleanName(t));
    }
  }
  return out.filter(validName);
}

// ---- 기타 필드 ----
const METHODS = [
  ['서술·논술', /서술\s*[·ㆍ‧∙.,]?\s*논술|서술형|논술형/],
  ['구술·발표', /구술|발표/],
  ['토의·토론', /토의|토론/],
  ['프로젝트', /프로젝트/],
  ['실험·실습', /실험|실습/],
  ['포트폴리오', /포트폴리오/],
  ['실기', /실기/],
  ['보고서', /보고서|소논문|리포트/],
  ['관찰', /교사\s*관찰|관찰\s*(평가|기록)/],
  ['자기평가', /자기\s*평가/],
  ['동료평가', /동료\s*평가/],
];
const TAGS = [
  ['탐구', /탐구/], ['실험', /실험/], ['보고서', /보고서|소논문|리포트/], ['발표', /발표|프레젠테이션|스피치/],
  ['토론', /토론|토의|논쟁/], ['제작', /제작|만들기|모형|카드뉴스|포스터|영상/], ['포트폴리오', /포트폴리오/],
  ['독서', /독서|독후|도서|책\s*읽/], ['글쓰기', /글쓰기|작문|에세이|쓰기|논술|서평/], ['프로젝트', /프로젝트|PBL/i],
  ['조사', /조사|설문|인터뷰/], ['관찰', /관찰/], ['감상·비평', /감상|비평/], ['창작', /창작|작곡|작품/],
  ['실기', /실기|연주|가창|경기|체력/], ['디지털·AI', /인공지능|AI|코딩|프로그래밍|디지털|에듀테크|데이터/i],
  ['모둠·협력', /모둠|협력|협업|팀/], ['문제해결', /문제\s*해결|해결\s*방안|설계/],
];
const STD_RE = /\[\s*\d{1,2}\s*[가-힣A-Za-zⅠⅡ\s·]{1,12}\d?\s*-?\s*\d{2}\s*-\s*\d{2}(?:-\d{2})?\s*\]/g;

function checkedMethods(text) {
  // 체크박스 양식(☑ 서술·논술 □ 구술·발표)이면 체크된 것만
  if (/[□☐]/.test(text) && /[☑☒■▣✔✓√▪]\s*[가-힣]/.test(text)) {
    const got = new Set();
    const re = /([☑☒■▣✔✓√])\s*([가-힣·ㆍ‧\s]{2,10})/g;
    let m;
    while ((m = re.exec(text))) for (const [k, r] of METHODS) if (r.test(m[2])) got.add(k);
    return [...got];
  }
  return METHODS.filter(([, r]) => r.test(text)).map(([k]) => k);
}

function firstMatch(re, s) { const m = s.match(re); return m ? m : null; }

// ================= 표 구조 기반 =================
const tNS = tb => NS(tb.rows.map(r => r.map(c => c.t).join(' ')).join(' '));
const LABEL_ROW = /^(평가)?영역|^수행평가(영역|명)|^과제명|영역.?횟수|^영역및횟수|^평가명|^수행과제|^내용$/;
const RUBRIC_HEAD = /채점기준|평가기준|세부기준|채점요소|평가요소|배점|척도|채점|평가내용|평가관점|평가항목|수행수준|점수/;
const NOT_RUBRIC = /^(주|시수|월|차시)$|단원명|수업방법|학사일정/;

function grid(tb) { // 병합을 펼친 격자
  const g = [];
  tb.rows.forEach((row, ri) => row.forEach(c => {
    const r = c.r !== undefined ? c.r : ri;
    for (let y = 0; y < (c.rs || 1); y++) for (let x = 0; x < (c.cs || 1); x++) { (g[r + y] || (g[r + y] = []))[c.c + x] = c; }
  }));
  return g;
}
function rowIndexOf(tb) { tb.rows.forEach((row, ri) => row.forEach(c => { if (c.r === undefined) c.r = ri; })); }

function tasksFromPlan(tb) {
  rowIndexOf(tb);
  const g = grid(tb);
  // 이름 줄: 첫 칸이 '영역/영역·횟수/평가영역…'
  let lr = -1, labelCell = null;
  for (let r = 0; r < g.length; r++) {
    const row = g[r] || []; const first = row.find(Boolean);
    if (first && LABEL_ROW.test(NS(first.t)) && NS(first.t).length <= 14) { lr = r; labelCell = first; break; }
  }
  // 수행평가 머리 칸의 열 범위
  let c1 = -1, c2 = -1;
  for (let r = 0; r < (lr >= 0 ? lr : g.length); r++) for (const c of (g[r] || [])) if (c && /^수행평가/.test(NS(c.t)) && c !== labelCell) { c1 = c.c; c2 = c.c + (c.cs || 1); break; }
  if (lr < 0 && c1 >= 0) { // 이름 줄이 표시되지 않은 표: 수행평가 머리 바로 아래 줄
    for (let r = 0; r < g.length; r++) if ((g[r] || []).some(c => c && /^수행평가/.test(NS(c.t)))) { lr = r + 1; break; }
  }
  if (lr < 0 || !g[lr]) return [];
  const seen = new Set(), out = [];
  for (const c of g[lr]) {
    if (!c || seen.has(c) || c === labelCell) continue; seen.add(c);
    if (c.r !== lr && c.rs > 1 && c.r < lr) continue; // 위에서 내려온 병합 칸
    if (c1 >= 0 && (c.c < c1 || c.c >= c2)) continue;
    if (c1 < 0) { // 수행 머리가 없으면 지필·합계 열은 빼기
      const head = (g[0] || [])[c.c];
      if (head && /지필|정기|합계|^계$/.test(NS(head.t))) continue;
    }
    const t = cleanName(String(c.t).replace(/\n/g, ' '));
    if (validName(t) && !SKIP.test(NS(t))) out.push(t);
  }
  return out;
}
function isPlanTable(tb) { const t = tNS(tb); return /수행평가/.test(t) && /반영|비율|영역/.test(t) && !/단원명|수업방법/.test(t.slice(0, 60)); }
function isRubricTable(tb) {
  if (tb.rows.length < 2 || tb.rows.length > 90) return false;
  const head = NS(tb.rows.slice(0, 2).map(r => r.map(c => c.t).join(' ')).join(' '));
  if (tb.rows[0].some(c => NOT_RUBRIC.test(NS(c.t)))) return false;
  const all = tNS(tb);
  if (/성취수준/.test(head) && !/\d점/.test(all)) return false;
  if (isPlanTable(tb) && !RUBRIC_HEAD.test(head)) return false;
  if (RUBRIC_HEAD.test(head)) return true;
  const pts = (all.match(/\d+(\.\d+)?점/g) || []).length;
  return pts >= 3 && /(^|[^가-힣])(상|중|하|우수|보통|미흡|매우)/.test(all);
}
function packTable(tb, kind, title, task) {
  rowIndexOf(tb);
  return { k: kind, ti: title || '', ta: task || '', r: tb.rows.slice(0, 60).map(row => row.map(c => [String(c.t).slice(0, 500), c.c, c.cs || 1, c.rs || 1])) };
}

// ---- PDF: 좌표 조각으로 표 비슷하게 만들기 ----
function pdfGrid(fs) {
  if (!fs.length) return null;
  const h = median(fs.map(f => f.h));
  const rows = [];
  for (const f of [...fs].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let r = rows.find(r => Math.abs(r.y - f.y) < h * 0.45);
    if (!r) { r = { y: f.y, fs: [] }; rows.push(r); }
    r.fs.push(f);
  }
  rows.sort((a, b) => b.y - a.y);
  const xs = fs.map(f => f.x).sort((a, b) => a - b);
  const cols = [];
  for (const x of xs) { const c = cols[cols.length - 1]; if (c && x - c.max < h * 1.2) { c.max = x; c.n++; } else cols.push({ min: x, max: x, n: 1 }); }
  const colOf = x => { let k = 0; for (let i = 0; i < cols.length; i++) if (cols[i].min <= x + h * 0.5) k = i; return k; };
  const out = [];
  let prevY = null;
  for (const r of rows) {
    const cells = new Map();
    for (const f of r.fs.sort((a, b) => a.x - b.x)) { const k = colOf(f.x); cells.set(k, (cells.has(k) ? cells.get(k) + ' ' : '') + f.s); }
    const last = out[out.length - 1];
    if (last && !cells.has(0) && prevY !== null && prevY - r.y < h * 1.7) { // 줄바꿈된 칸 이어 붙이기
      for (const [k, t] of cells) { const c = last.find(c => c.c === k); if (c) c.t += ' ' + t; else last.push({ t, c: k, cs: 1, rs: 1 }); }
      last.sort((a, b) => a.c - b.c);
    } else out.push([...cells].map(([k, t]) => ({ t, c: k, cs: 1, rs: 1 })));
    prevY = r.y;
  }
  return { rows: out.slice(0, 60) };
}
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 10; }
function pdfTables(frags, pFrom, pTo) {
  const res = { plan: null, rubrics: [] };
  for (let p = pFrom; p <= pTo; p++) {
    const fs = frags.filter(f => f.p === p);
    if (!fs.length) continue;
    const h = median(fs.map(f => f.h));
    // 반영 비율 표
    if (!res.plan) {
      const F = fs.find(f => /^수행평가(\(?\d+(\.\d+)?%\)?)?$/.test(NS(f.s)) && fs.some(g => Math.abs(g.y - f.y) < h * 0.6 && g.x < f.x && /지필|정기/.test(NS(g.s))));
      if (F) {
        const below = fs.filter(f => f.y <= F.y + h * 3).sort((a, b) => b.y - a.y);
        let bottom = F.y - h * 22;
        const stop = below.find(f => f.y < F.y - h && /^(관련)?성취기준|^성취기준코드|^평가시기$/.test(NS(f.s)));
        if (stop) bottom = stop.y + h * 0.5;
        const region = fs.filter(f => f.y <= F.y + h * 3 && f.y > bottom);
        const g = pdfGrid(region);
        if (g && g.rows.length >= 2) res.plan = g;
      }
    }
    // 채점 기준 표
    for (const H of fs.filter(f => /^(세부)?(채점|평가)(기준|요소)(표)?$|^채점기준및배점$|^평가기준및배점$/.test(NS(f.s)))) {
      if (res.rubrics.some(r => r.p === p && Math.abs(r.y - H.y) < h * 30)) continue;
      const region = fs.filter(f => f.y <= H.y + h * 0.6 && f.y > H.y - h * 55);
      // 다음 큰 제목(왼쪽 끝의 "3." "나." 등)에서 끊기
      const left = Math.min(...fs.map(f => f.x));
      const brk = region.filter(f => f.y < H.y - h * 4 && f.x < left + h * 2 && /^(\d+\.|[가-하]\.|[①-⑩])\s*\S/.test(f.s) && f.s.length > 6).sort((a, b) => b.y - a.y)[0];
      const rg = brk ? region.filter(f => f.y > brk.y + h * 0.3) : region;
      const g = pdfGrid(rg);
      if (g && g.rows.length >= 3) res.rubrics.push({ p, y: H.y, ...g });
    }
  }
  return res;
}

function analyzeSegment(lines, seg, frags, pageOf, blocks) {
  const { start, end } = seg;
  // 표 구조가 있으면(HWP·HWPX) 그 안에서 수행평가 영역과 채점 기준표를 찾는다
  const segBlocks = (blocks || []).filter(b => b.line >= start && b.line < end);
  let planTb = null, fromPlan = [];
  for (const b of segBlocks) if (b.type === 'table' && isPlanTable(b)) { const t = tasksFromPlan(b); if (t.length || !planTb) { planTb = b; fromPlan = t; } if (t.length) break; }
  // 평가 계획 부분 찾기: "수행평가"가 처음으로 표 머리/반영비율과 함께 나오는 곳
  let evalStart = -1;
  for (let i = start; i < end; i++) {
    const n = NS(lines[i]);
    if (/수행평가\(?\d+(\.\d+)?%|반영비율|평가방법과반영|평가세부|영역·?횟수|수행평가세부|수행평가영역|평가영역/.test(n)) { evalStart = i; break; }
  }
  const names = [];
  const isPdf = !!(frags && frags.length);
  const fromT = fromPlan.length ? fromPlan : isPdf ? namesFromPdfTable(frags, pageOf[start], pageOf[Math.max(start, end - 1)]) : namesFromTable(lines, start, end);
  const fromP = fromPlan.length ? [] : namesFromPatterns(lines, start, end, isPdf);
  for (const t of [...fromT, ...fromP]) {
    const k = NS(t);
    if (!names.some(x => NS(x) === k)) names.push(t);
  }
  // 다른 이름의 일부인 짧은 이름은 뺀다
  for (let i = names.length - 1; i >= 0; i--) {
    const k = NS(names[i]);
    if (names.some((x, j) => j !== i && NS(x).length > k.length && NS(x).includes(k))) names.splice(i, 1);
  }
  const segText = lines.slice(start, end).join('\n');
  const evalText = lines.slice(evalStart >= 0 ? evalStart : start, end).join('\n');
  if (!names.length && !/수\s*행\s*평\s*가/.test(segText)) return null;

  const perf = firstMatch(/수\s*행\s*평\s*가\s*\(?\s*(\d{1,3}(?:\.\d+)?)\s*%/, evalText) || firstMatch(/수\s*행\s*평\s*가[^\n%]{0,15}?(\d{1,3}(?:\.\d+)?)\s*%/, evalText);
  const exam = firstMatch(/(?:정기\s*시험|지필\s*평가|지필)\s*\(?\s*(\d{1,3}(?:\.\d+)?)\s*%/, evalText);
  const standards = [...new Set((segText.match(STD_RE) || []).map(s => s.replace(/\s+/g, '')))];
  // 방법·특징은 일반 방침 문장이 아니라 과제명과 평가표 근처 짧은 칸에서만 본다
  const winFrom = evalStart >= 0 ? evalStart : start;
  const tableWin = lines.slice(winFrom, Math.min(end, winFrom + 60))
    .filter(l => NS(l).length <= 45 && !/(한다|있다|된다|않는다|활용|다양한)/.test(l)).join('\n');
  const methods = checkedMethods(names.join('\n') + '\n' + tableWin);
  const tagSrc = names.join(' ') + ' ' + tableWin;
  const tags = TAGS.filter(([, r]) => r.test(tagSrc)).map(([k]) => k);

  // 근거 표지
  const ev = {
    rubric: (evalText.match(/채점\s*기준|평가\s*기준|세부\s*기준|루브릭|(^|\n)\s*(상|중|하|A|B|C|D|E)\s*($|\n|[│|])/g) || []).length,
    standard: standards.length,
    points: (evalText.match(/\d+\s*점|\d+(\.\d+)?\s*%/g) || []).length,
    method: methods.length,
  };
  const score = Math.min(100, (ev.rubric ? 30 : 0) + (ev.standard ? 25 : 0) + (ev.points ? 20 : 0) + (ev.method ? 15 : 0) + (names.length ? 10 : 0));

  // 발췌: 평가 계획 부분 앞쪽
  const exFrom = evalStart >= 0 ? evalStart : start;
  const excerpt = lines.slice(exFrom, Math.min(end, exFrom + 90)).filter(l => l !== '<<PAGE>>').join(' / ').replace(/\s+/g, ' ').slice(0, 1800);

  // ---- 표 묶기 ----
  const tables = [];
  if (segBlocks.length) {
    if (planTb) tables.push(packTable(planTb, 'plan', '평가 방법과 반영 비율'));
    let lastP = '';
    const pIdx = segBlocks.indexOf(planTb);
    segBlocks.forEach((b, i) => {
      if (b.type === 'p') { if (NS(b.text).length <= 80) lastP = b.text; return; }
      if (b === planTb || tables.length >= 9 || !isRubricTable(b)) return;
      if (planTb && i < pIdx) return; // 반영 비율 표 앞(주간 계획 등)은 건너뜀
      const tt = tNS(b) + NS(lastP);
      const task = [...names].sort((a, c) => NS(c).length - NS(a).length).find(n => NS(n).length >= 3 && tt.includes(NS(n))) || '';
      tables.push(packTable(b, 'rubric', lastP, task));
    });
  } else if (isPdf) {
    const pt = pdfTables(frags, pageOf[start], pageOf[Math.max(start, end - 1)]);
    if (pt.plan) tables.push(packTable(pt.plan, 'plan', '평가 방법과 반영 비율 (PDF에서 재구성)'));
    for (const rb of pt.rubrics.slice(0, 8)) {
      const tt = tNS(rb);
      const task = [...names].sort((a, c) => NS(c).length - NS(a).length).find(n => NS(n).length >= 3 && tt.includes(NS(n))) || '';
      tables.push(packTable(rb, 'rubric', '채점 기준 (PDF에서 재구성)', task));
    }
  }

  return { tables, tasks: names.slice(0, 12), perfWeight: perf ? +perf[1] : null, examWeight: exam ? +exam[1] : null, standards: standards.slice(0, 30), methods, tags, evidence: ev, score, excerpt };
}

function gradeOf(s) { const m = NS(s).match(/([1-3])학년/); return m ? +m[1] : null; }
function semesterOf(s) { const m = NS(s).match(/([12])학기/); return m ? +m[1] : null; }

// 문서 하나 → 사례 목록
// 목록에 없는 학교 지정 과목: 파일명 "(1학년 과목명)" 이나 "과목명" 칸에서 이름을 얻는다
function guessSubject(lines, fileName) {
  let name = '';
  const m = String(fileName || '').match(/\(\s*\d\s*학년\s*([^)]{2,25})\)/) || String(fileName || '').match(/\d\s*학년[\s_-]+([가-힣A-Za-z0-9·ⅠⅡ\s]{2,25}?)(?:[\s_-]*(?:교수|평가|운영|계획)|\.\w+$)/);
  if (m) name = m[1].trim();
  if (!name) {
    for (let i = 0; i < Math.min(lines.length - 1, 300); i++) {
      if (/^(과목|과목명|교과목|교과목명)[:：]?$/.test(NS(lines[i])) && NS(lines[i + 1]).length <= 20 && /[가-힣]/.test(lines[i + 1])) { name = lines[i + 1].trim(); break; }
    }
  }
  if (!name || !/[가-힣]{2}/.test(name) || /교수|평가|계획|학기|학년|교육과정/.test(name)) return null;
  return { name, norm: normName(name), group: '기타', curs: ['2015', '2022'], guessed: true };
}

// 파일명에서 과목: 괄호 안 이름을 먼저 정확히 맞춰 보고, 없으면 파일명 전체에서 찾는다
function subjectFromFileName(fileName) {
  const name = String(fileName || '');
  const SKIPW = /교수|평가|계획|학기|학년도|수정|최종|정보공시|운영|통합본|보통교과|전문교과|공동교육과정|과목\)|학교$|고등|중학|^(국어|수학|영어|사회|과학|도덕|체육|예술|음악|미술|기술|가정|기술·?가정|정보|제2외국어|외국어|한문|교양|진로|전문)\s*(교과|과|교과군)$/;
  for (const m of name.matchAll(/[(\[]([^()\[\]]{2,30})[)\]]/g)) {
    const inner = m[1].replace(/\d\s*학년\s*/g, '').replace(/[\s_-]*\(?(수정|최종|수정본|변경|정정)\d*\)?$/, '').trim();
    if (!inner || SKIPW.test(inner) || !/[가-힣]/.test(inner)) continue;
    const s = findSubject(normName(inner));
    if (s && s.norm === normName(inner)) return s;
    if (inner.length <= 20 && !/\d{4}|[,，]/.test(inner)) return { name: inner, norm: normName(inner), group: '기타', curs: ['2015', '2022'], guessed: true };
  }
  return findSubject(normName(name.replace(/정보\s*공시/g, '')));
}

function detectCases(lines, meta, frags, blocks) {
  const fileSubject = subjectFromFileName(meta.fileName);
  // 과목별 파일이면(파일명에 과목명) 파일 전체를 그 과목 하나로 본다
  let segs;
  if (fileSubject) {
    const distinct = [...new Set(findHeaders(lines).map(h => h.subj))];
    let subj = fileSubject;
    if (!fileSubject.guessed && distinct.length === 1) subj = distinct[0]; // 본문 머리글이 더 정확
    if (!fileSubject.guessed && distinct.length > 1 && !distinct.includes(fileSubject)) segs = splitSubjects(lines, null);
    else segs = [{ subj, start: 0, end: lines.length }];
  } else segs = splitSubjects(lines, null);
  if (!segs.length) { const g = guessSubject(lines, meta.fileName); if (g) segs = [{ subj: g, start: 0, end: lines.length }]; }
  const pageOf = new Array(lines.length); let pg = 0;
  for (let i = 0; i < lines.length; i++) { pageOf[i] = pg; if (lines[i] === '<<PAGE>>') pg++; }
  const out = [];
  for (const seg of segs) {
    const r = analyzeSegment(lines, seg, frags, pageOf, blocks);
    if (!r) continue;
    const head = lines.slice(seg.start, Math.min(seg.end, seg.start + 6)).join(' ');
    const grade = gradeOf(head) || gradeOf(meta.fileName) || null;
    const semester = semesterOf(head) || semesterOf(meta.fileName) || (meta.chasu === 1 ? 1 : meta.chasu === 3 ? 2 : null);
    const { cur, ambiguous } = curriculumOf(seg.subj, grade, meta.year);
    out.push({ subject: seg.subj.name, group: seg.subj.group, curriculum: cur, curAmbiguous: ambiguous, grade, semester, ...r });
  }
  return out;
}

module.exports = { namesFromPdfTable, detectCases, splitSubjects, analyzeSegment, findHeaders, cleanName, validName };
