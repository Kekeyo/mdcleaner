@echo off
chcp 65001 >nul
title Markdown Cleaner
cd /d "%~dp0"
set "PY=python"
if exist "%~dp0.venv\Scripts\python.exe" set "PY=%~dp0.venv\Scripts\python.exe"

rem 已经在跑就直接打开页面，没跑就启动服务（这个窗口就是服务，关掉即停止）
powershell -NoProfile -Command "try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',8765); $c.Close(); exit 0 }catch{ exit 1 }"
if %errorlevel%==0 (
  start "" "http://127.0.0.1:8765/"
  exit /b
)

echo 正在启动 Markdown 公式清洗页...
"%PY%" server.py
pause