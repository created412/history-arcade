@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 시간여행 역사
where node > nul 2> nul
if errorlevel 1 (
  echo Node.js가 없습니다. https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
echo 시간여행 역사를 켭니다. 이 창을 닫으면 사이트도 꺼집니다.
start "" http://localhost:3000
node server.js
pause
