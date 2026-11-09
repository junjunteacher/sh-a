# 수행평가 아이디어 아카이브 (made by junjunT)

학교알리미에 공시된 **「4-가. 교과별(학년별) 교수·학습 및 평가계획에 관한 사항」** 첨부파일을 프로그램이 스스로 내려받아, 과목마다 수행평가 영역명·반영 비율·평가 방법·성취기준을 뽑아 검색할 수 있게 만든 웹앱입니다. 생명과학만이 아니라 **모든 과목**을 모읍니다.

```
학교알리미 ──(자동 수집: GitHub Actions 또는 내 컴퓨터)──▶ docs/data ──▶ 웹앱(docs/index.html, GitHub Pages)
```

## 1. 처음 한 번만: GitHub에 올리기

1. GitHub에서 새 저장소를 만듭니다(예: `suhaeng-archive`, **Public** 권장 — Actions 무료).
2. 이 폴더 전체를 저장소에 올립니다(GitHub Desktop 사용 가능). `node_modules` 폴더는 올리지 않습니다.
3. 저장소 **Settings → Pages** 에서 Source를 `Deploy from a branch`, Branch를 `main` / `/docs` 로 저장합니다.
4. 저장소 **Settings → Actions → General → Workflow permissions** 를 `Read and write permissions` 로 바꿉니다(수집 결과를 저장소에 저장하기 위해 필요).

## 2. 자동 수집 돌리기

- **Actions → 학교알리미 수집 → Run workflow** 를 누르면 시작합니다.
  - `sido` 칸을 비우면 전국, `1200000000` 처럼 넣으면 그 시·도만 모읍니다.
  - `level` 은 `04`(고등학교) 기본, `03` 을 넣으면 중학교.
- 이후에는 **매일 새벽 3시 17분**에 저절로 돌며, 새로 올라오거나 바뀐 첨부파일만 다시 읽습니다.
- 첫 전국 수집은 파일이 많아 한 번에 다 끝나지 않을 수 있습니다(시·도별 작업 하나당 최대 약 5시간30분). 끝나지 않은 학교는 다음 실행에서 이어서 합니다.
- 수집이 끝나면 `docs/data` 가 갱신되어 웹앱에 바로 반영됩니다.

> ⚠️ GitHub 서버(해외)에서 학교알리미 접속이 막히는 경우가 있습니다. Actions 기록에 `fetch failed`, `HTTP 403` 등이 반복되면 아래 3번 방법을 쓰세요.

## 3. 내 컴퓨터에서 수집하기(Windows)

1. [Node.js LTS](https://nodejs.org) 를 설치합니다.
2. `run-collect.bat` 을 두 번 누르고 시·도 코드를 넣습니다(처음에는 부품 설치로 1~2분 걸림).
3. 끝나면 GitHub Desktop 으로 `docs/data` 변경을 커밋·푸시합니다.
4. 올리기 전 내 컴퓨터에서 보려면 `npm run serve` 후 http://localhost:8080 을 엽니다.

명령줄로 직접 돌릴 수도 있습니다.

```bash
npm install
node collector/collect.js --sido 1200000000            # 전남광주 고등학교
node collector/collect.js --sido 1200000000 --gugun 1230000000 --limit 5   # 북구 5개 학교만 시험
node collector/collect.js --sido 4100000000 --level 03  # 경기 중학교
node collector/build.js                                 # 웹앱용 색인 만들기
```

| 옵션 | 뜻 |
|---|---|
| `--sido` | 시·도 코드(필수) |
| `--level` | `04` 고등학교(기본), `03` 중학교 |
| `--gugun` | 시·군·구 코드 하나만 |
| `--limit` | 앞에서부터 N개 학교만(시험용) |
| `--budget` | 분 단위 시간 제한(기본 330) |
| `--delay` | 요청 사이 간격 ms(기본 350, 학교알리미 서버 부담을 줄이기 위해 낮추지 마세요) |

## 4. 웹앱 기능

- **사례 찾기**: 교과군·과목·교육과정·학년·학기·시·도·시·군·구·평가 방법·활동 특징·검색어로 거르기, 정렬, 엑셀 내려받기, 주소에 조건 저장(링크 공유 가능)
- **상세 보기**: 수행평가 영역, 반영 비율, 평가 방법, 성취기준 코드, 근거 점수, 평가표 부근 발췌, **학교알리미 원문 내려받기**·학교 공시 화면 링크
- **경향**: 반영 비율 분포, 평가 방법, 활동 특징, 과제명에 자주 나오는 말, 지역·과목별 분포
- **방식별 보기**: 활동 특징 × 평가 방법 표 — 칸을 누르면 해당 사례로 이동
- **비교**: 최대 4개 나란히
- **검토함**: 채택 / 수정해서 쓰기 / 보류 표시와 메모(브라우저에 저장), 엑셀 내려받기

## 4-1. 앱으로 설치

- 크롬·엣지: 오른쪽 위 **⤓ 앱 설치** 버튼(또는 주소창의 설치 아이콘) → 바탕화면·시작 메뉴에 앱으로 생깁니다.
- 안드로이드 크롬: 같은 버튼 또는 메뉴 → 홈 화면에 추가.
- 아이폰·아이패드: 사파리 공유(□↑) → 홈 화면에 추가.
- 한 번 본 과목·평가표는 저장되어 인터넷이 약해도 빨리 열립니다.

## 5. 폴더 구성

```
collector/
  schoolinfo.js   학교알리미 요청(학교 목록, 평가계획 공시, 첨부 내려받기)
  extract.js      PDF·HWP·HWPX·ZIP 본문 추출
  subjects.js     2015·2022 개정 고등학교 과목 목록
  detect.js       과목 구간 나누기와 수행평가 검출 규칙
  collect.js      시·도 단위 수집(이어하기 지원) → docs/data/raw/*.json.gz
  build.js        raw → docs/data/meta.json, docs/data/subjects/*.json
docs/index.html   웹앱(단일 파일)
docs/sw.js, manifest.webmanifest, icons/   앱 설치용
docs/_config.yml  Pages 배포에서 data/details·data/raw 제외(배포 시간 단축)
docs/data/dpack/  학교별 상세(평가표)를 지역별로 묶은 파일 — build.js가 만듦
.github/workflows/collect.yml   자동 수집
```

## 6. 알아 둘 점

- 원문 첨부파일은 저장하거나 다시 배포하지 않습니다. 발췌(최대 900자)와 원문 링크만 둡니다.
- 스캔한 그림 PDF, 배포용(암호) 한글 문서는 읽지 못합니다. **찾지 못했다고 수행평가가 없는 것은 아닙니다.**
- 수행평가 영역명은 표 모양을 보고 규칙으로 뽑으므로 일부 틀리거나 빠질 수 있습니다. 설계에 쓰기 전 원문을 꼭 확인하세요.
- 학교알리미 서버에 부담을 주지 않도록 요청 사이에 간격을 두고, 이미 읽은 파일은 다시 내려받지 않습니다.
