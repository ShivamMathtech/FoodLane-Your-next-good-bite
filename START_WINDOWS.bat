@echo off
setlocal
cd /d "%~dp0"
title FoodLane - Food Delivery App
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required. Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
node scripts/check-node.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo Starting FoodLane. Keep this window open while using the application.
echo Default address: http://localhost:3000
echo Demo accounts are listed in START_HERE.txt and in the sign-in screen.
echo.
node server/start.mjs
pause
