@echo off
chcp 65001 >nul
setlocal

set "DEST=%USERPROFILE%\.gemini\config\plugins\workspace-file-tree"
if exist "%DEST%" (
  rmdir /s /q "%DEST%"
  echo 已卸载 Workspace File Tree 插件：%DEST%
) else (
  echo 未检测到已安装的 Workspace File Tree 插件。
)
echo.
pause
