@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\startup.ps1" -Mode Disable
if errorlevel 1 goto failed
echo 已取消墨页登录自启。当前服务不会被中断。
echo 如需同时停止当前服务，请双击“关闭墨页.vbs”。
pause
exit /b 0
:failed
echo 取消失败，请查看上面的错误；未删除其他程序的启动项。
pause
exit /b 1
