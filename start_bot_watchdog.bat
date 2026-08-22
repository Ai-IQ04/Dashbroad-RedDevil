@echo off
title RedDevil Discord Bot Watchdog
color 0A

:start
echo [%date% %time%] Starting RedDevil Discord Bot...
node bot.js
echo.
echo Bot stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto start
