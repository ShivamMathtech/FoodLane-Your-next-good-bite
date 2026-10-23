@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 first: https://nodejs.org/
  pause
  exit /b 1
)
node scripts/check-node.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo Dependency installation failed. Check your internet connection and retry.
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  pause
  exit /b 1
)
call npm test
echo.
echo Rebuild finished. If all checks passed, run START_WINDOWS.bat.
pause
