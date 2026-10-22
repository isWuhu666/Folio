@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" goto missing
if not exist "web\vendor\mathjax\tex-svg.js" goto missing
wscript.exe "%~dp0打开墨页.vbs" %*
exit /b
:missing
echo 请先运行 安装.cmd 准备本地依赖。
pause
exit /b 1
