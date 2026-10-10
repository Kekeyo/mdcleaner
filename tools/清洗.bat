@echo off
chcp 65001 >nul
REM 把 .md 文件拖到本文件图标上即可清洗（会先生成“.备份.md”）。
REM 只想检查不修改：在命令行里运行  清洗.bat 文件.md --check
if "%~1"=="" (
  echo 用法: 把 .md 文件拖到 清洗.bat 上，或  清洗.bat 文件.md [--check] [-o 输出.md]
  pause
  exit /b 1
)
node "%~dp0md_cleaner.js" %*
echo.
pause
