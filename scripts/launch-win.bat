@echo off
chcp 65001 >nul
setlocal

set "AG_EXE="
for %%P in (
  "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
  "%LOCALAPPDATA%\Antigravity\Antigravity.exe"
  "%ProgramFiles%\Antigravity\Antigravity.exe"
  "%ProgramFiles(x86)%\Antigravity\Antigravity.exe"
) do (
  if not defined AG_EXE (
    if exist %%~P set "AG_EXE=%%~P"
  )
)

if not defined AG_EXE (
  where antigravity >nul 2>&1
  if not errorlevel 1 (
    start "" antigravity --remote-debugging-port=9222
    exit /b 0
  )
  echo [提示] 未在默认位置找到 Antigravity.exe。
  echo 请右键原来的 Antigravity 桌面快捷方式 -> 属性 -> 在「目标」末尾添加：
  echo     --remote-debugging-port=9222
  echo.
  pause
  exit /b 1
)

start "" "%AG_EXE%" --remote-debugging-port=9222
exit /b 0
