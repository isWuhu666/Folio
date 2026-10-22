@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\startup.ps1" -Mode Enable
if errorlevel 1 goto failed
echo 已启用墨页登录自启：登录 Windows 后静默运行，不弹出浏览器。
echo 如需立即使用，请双击“打开墨页.vbs”。
pause
exit /b 0
:failed
echo 设置失败，请查看上面的错误；未覆盖其他程序的启动项。
pause
exit /b 1
