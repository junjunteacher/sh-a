// 학교알리미(schoolinfo.go.kr) 요청 모음 — 브라우저에서 확인한 실제 요청 형식 그대로
const BASE = process.env.SCHOOLINFO_BASE || 'https://www.schoolinfo.go.kr';
const UA = 'Mozilla/5.0 (compatible; suhaeng-archive-collector/1.0; +https://github.com/)';

const SIDO = {
  '1100000000': '서울특별시', '1200000000': '전남광주통합특별시', '2600000000': '부산광역시', '2700000000': '대구광역시',
  '2800000000': '인천광역시', '3000000000': '대전광역시', '3100000000': '울산광역시', '3611000000': '세종특별자치시',
  '4100000000': '경기도', '4300000000': '충청북도', '4400000000': '충청남도', '4700000000': '경상북도',
  '4800000000': '경상남도', '5000000000': '제주특별자치도', '5100000000': '강원특별자치도', '5200000000': '전북특별자치도',
};

// 평가계획 공시 항목(4-가) 고정값
const PLAN = { GS_HANGMOK_CD: '43', GS_HANGMOK_NO: '4-가', GS_HANGMOK_NM: '교과별(학년별) 교수ㆍ학습 및 평가계획에 관한 사항', GS_BURYU_CD: 'JG110', JG_BURYU_CD: 'JG040', JG_HANGMOK_CD: '14', JG_GUBUN: '1' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Client {
  constructor({ delay = 350, retries = 3 } = {}) { this.cookies = new Map(); this.delay = delay; this.retries = retries; this.last = 0; }

  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  keepCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const c of list) { const m = c.match(/^([^=;\s]+)=([^;]*)/); if (m) this.cookies.set(m[1], m[2]); }
  }

  async req(path, { method = 'GET', form = null, timeout = 120000 } = {}) {
    let lastErr;
    for (let a = 0; a <= this.retries; a++) {
      const wait = this.last + this.delay - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeout);
      try {
        // 압축 전송(gzip) 끝에 찌꺼기가 붙은 응답 때문에 프로그램이 멈추는 일을 막으려고 압축 없이 받는다
        const headers = { 'User-Agent': UA, 'Referer': BASE + '/ei/ss/pneiss_a03_s0.do', 'Accept-Language': 'ko-KR,ko;q=0.9', 'Accept-Encoding': 'identity' };
        if (this.cookies.size) headers.Cookie = this.cookieHeader();
        let body;
        if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; headers['X-Requested-With'] = 'XMLHttpRequest'; body = new URLSearchParams(form).toString(); }
        const res = await fetch(BASE + path, { method, headers, body, signal: ctl.signal, redirect: 'follow' });
        this.keepCookies(res);
        if (res.status >= 500 || res.status === 429) throw new Error('HTTP ' + res.status);
        const buf = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, headers: res.headers, buf };
      } catch (e) {
        lastErr = e;
        await sleep(1500 * (a + 1) ** 2);
      } finally { clearTimeout(t); }
    }
    throw lastErr;
  }

  static decode(r) {
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const enc = /euc-kr|ks_c_5601|cp949/.test(ct) ? 'euc-kr' : 'utf-8';
    let t = new TextDecoder(enc).decode(r.buf);
    if (enc === 'utf-8' && t.includes('�')) t = new TextDecoder('euc-kr').decode(r.buf);
    return t;
  }

  async init() { await this.req('/ei/ss/pneiss_a03_s0.do'); }

  async json(path, form) {
    const r = await this.req(path, { method: 'POST', form });
    const t = Client.decode(r);
    try { return JSON.parse(t); } catch (e) { throw new Error(`JSON 아님(${path}): ${t.slice(0, 120)}`); }
  }

  sigungu(sido) { return this.json('/ei/ss/pneiss_a03_s0_sigungu_json.do', { SIDO_CODE: sido }); }
  schools(level, sido, gugun) { return this.json('/ei/ss/pneiss_a03_s0_school_json.do', { HG_JONGRYU_GB: level, SIDO_CODE: sido, GUGUN_CODE: gugun || '' }); }

  // 평가계획 공시 화면 → 첨부 목록과 내려받기 양식값
  async plan(sid, schoolName, yearChasu = '') {
    const year = yearChasu ? yearChasu.slice(0, 4) : String(new Date().getFullYear());
    const form = { ...PLAN, JG_YEAR2: '', HG_NM: schoolName, SHL_IDF_CD: sid, GS_TYPE: 'Y', JG_YEAR: year, SORT: 'BR', CHOSEN_JG_YEAR: year, PRE_JG_YEAR: year, LOAD_TYPE: 'single' };
    if (yearChasu) form.JG_CHASU = yearChasu.slice(4);
    const r = await this.req('/ei/pp/Pneipp_b43_s0p.do', { method: 'POST', form });
    const html = Client.decode(r);
    return parsePlan(html);
  }

  downloadUrl(form, seq) {
    const q = new URLSearchParams({ ...form, FILE_SEQ: String(seq) });
    return '/servlets/EiFileDownLoad.do?' + q.toString();
  }

  async download(form, seq) {
    const r = await this.req(this.downloadUrl(form, seq), { timeout: 300000 });
    if (r.status !== 200) throw new Error('내려받기 실패 HTTP ' + r.status);
    return r.buf;
  }
}

function attr(tag, name) { const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i')) || tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i')); return m ? m[1] : ''; }
function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); }

function parsePlan(html) {
  // 공시 차수 목록: <option value="20263">(3차) 2026년 09월</option>
  const opts = [...html.matchAll(/<option[^>]*value\s*=\s*["']?(\d{5})["']?[^>]*>/gi)].map(m => m[1]);
  // 내려받기 양식
  const form = {};
  const fm = html.match(/<form[^>]*id\s*=\s*["']eiFileDownForm["'][\s\S]*?<\/form>/i);
  if (fm) for (const inp of fm[0].match(/<input[^>]*>/gi) || []) { const n = attr(inp, 'name'); if (n) form[n] = attr(inp, 'value'); }
  // 첨부: ① 평가계획 / ② 학업성적관리규정 구분
  const files = [];
  const re = /getEiFile\d+\(\s*'?(\d+)'?\s*\)[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = stripTags(m[2]);
    const before = html.slice(Math.max(0, m.index - 4000), m.index);
    const lastCircle2 = before.lastIndexOf('②'), lastCircle1 = before.lastIndexOf('①');
    const section = lastCircle2 > lastCircle1 ? 2 : 1;
    const sm = text.match(/^(.*?)(?:\s*\(([\d,.]+\s*[KMG]?B)\))?$/i);
    files.push({ seq: m[1], name: (sm ? sm[1] : text).trim(), size: sm && sm[2] ? sm[2] : '', section });
  }
  // 같은 seq 중복 제거
  const seen = new Set();
  const uniq = files.filter(f => (seen.has(f.seq) ? false : seen.add(f.seq)));
  const writer = (stripTags(html).match(/작성자\s*:\s*([^|]+)/) || [])[1];
  return { opts, form, files: uniq, writer: writer ? writer.trim() : '' };
}

module.exports = { Client, SIDO, parsePlan, BASE };
