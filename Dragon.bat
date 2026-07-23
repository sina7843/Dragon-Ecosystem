@echo off
setlocal
title Dragon Ecosystem

cd /d D:\CLaude\Dragon-Ecosystem-Windows-Starter

if /i "%~1"=="stop" goto stop

echo.
echo Stopping old containers...
docker compose down
if errorlevel 1 goto error

echo.
echo Starting Dragon Ecosystem in local development mode...
docker compose up -d --force-recreate
if errorlevel 1 goto error

echo.
echo Waiting for services...
timeout /t 12 /nobreak >nul

echo.
docker compose ps

echo.
echo API logs:
docker compose logs --tail=25 api

echo.
echo ========================================
echo Dragon Ecosystem started.
echo Open the address shown for the web service.
echo ========================================
echo.
pause
exit /b 0

:stop
echo.
echo Stopping Dragon Ecosystem...
docker compose down
echo.
echo Project stopped. Database data was preserved.
pause
exit /b 0

:error
echo.
echo ========================================
echo Startup failed.
echo ========================================
docker compose ps
docker compose logs --tail=100 api
pause
exit /b 1