@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ========================================================
echo   Antigravity Workspace File Tree - Windows 一键安装
echo ========================================================
echo.

for %%I in ("%~dp0..") do set "REPO_ROOT=%%~fI"
set "DEST=%USERPROFILE%\.gemini\config\plugins\workspace-file-tree"

if not exist "%REPO_ROOT%\plugin.json" (
  echo [错误] 未找到 plugin.json，请先将压缩包完整解压后再运行本脚本！
  pause
  exit /b 1
)

echo [1/2] 正在安装插件到: %DEST%
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%REPO_ROOT%\plugin.json" "%DEST%\plugin.json" >nul
copy /y "%REPO_ROOT%\README.md" "%DEST%\README.md" >nul
robocopy "%REPO_ROOT%\assets" "%DEST%\assets" /MIR /NFL /NDL /NJH /NJS /NC /NS >nul
robocopy "%REPO_ROOT%\sidecars" "%DEST%\sidecars" /MIR /NFL /NDL /NJH /NJS /NC /NS >nul
if errorlevel 8 (
  echo [错误] 复制文件失败，请关闭 Antigravity 后重试。
  pause
  exit /b 1
)
echo       插件安装完成！
echo.

echo [2/2] 正在查找 Antigravity.exe 并创建桌面快捷方式...
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

if defined AG_EXE (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('Desktop'); $sc = $ws.CreateShortcut((Join-Path $desk 'Antigravity (增强版).lnk')); $sc.TargetPath = '%AG_EXE%'; $sc.Arguments = '--remote-debugging-port=9222'; $sc.WorkingDirectory = (Split-Path '%AG_EXE%'); $sc.IconLocation = '%AG_EXE%,0'; $sc.Save()" >nul 2>&1
  if not errorlevel 1 (
    echo       已在桌面创建快捷方式: Antigravity (增强版)
  ) else (
    echo       未自动创建快捷方式，可直接双击 scripts\launch-win.bat 启动。
  )
) else (
  echo       未在默认位置找到 Antigravity.exe，请参考 README 在原快捷方式末尾添加 --remote-debugging-port=9222。
)

echo.
echo ========================================================
echo   安装完成！
echo   1. 完全退出当前 Antigravity，用桌面「Antigravity (增强版)」重新打开
echo   2. 在左侧 Customizations / Plugins 中开启 Workspace File Tree
echo ========================================================
echo.
pause
