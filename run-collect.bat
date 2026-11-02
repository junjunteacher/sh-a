@echo off
chcp 65001 > nul
title 수행평가 아카이브 - 학교알리미 수집
cd /d "%~dp0"
where node > nul 2> nul
if errorlevel 1 (
  echo [안내] Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b
)
if not exist node_modules (
  echo 처음 실행: 필요한 부품을 설치합니다...
  call npm install --omit=dev
)
echo.
echo 시도 코드
echo   1100000000 서울      1200000000 전남광주   2600000000 부산   2700000000 대구
echo   2800000000 인천      3000000000 대전       3100000000 울산   3611000000 세종
echo   4100000000 경기      4300000000 충북       4400000000 충남   4700000000 경북
echo   4800000000 경남      5000000000 제주       5100000000 강원   5200000000 전북
echo   ALL = 전국(오래 걸림)
echo.
set /p SIDO=수집할 시도 코드를 입력하세요: 
set /p LEVEL=학교급 (04 고등학교 / 03 중학교, 그냥 Enter = 04): 
if "%LEVEL%"=="" set LEVEL=04
if /i "%SIDO%"=="ALL" (
  for %%S in (1100000000 1200000000 2600000000 2700000000 2800000000 3000000000 3100000000 3611000000 4100000000 4300000000 4400000000 4700000000 4800000000 5000000000 5100000000 5200000000) do node collector\collect.js --sido %%S --level %LEVEL% --budget 100000
) else (
  node collector\collect.js --sido %SIDO% --level %LEVEL% --budget 100000
)
node collector\build.js
echo.
echo 끝났습니다. docs\data 폴더가 갱신되었습니다. GitHub Desktop 으로 커밋하고 올리면 웹앱에 반영됩니다.
echo 내 컴퓨터에서 바로 보려면: npm run serve  (주소 http://localhost:8080)
pause
