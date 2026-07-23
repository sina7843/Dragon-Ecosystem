@echo off
setlocal enabledelayedexpansion
title Dragon Ecosystem - Seed Demo Data

cd /d D:\CLaude\Dragon-Ecosystem-Windows-Starter

echo.
echo ========================================
echo Dragon Ecosystem - development demo data
echo ========================================
echo.
echo Seeds fictional demo data into the LOCAL development database (dragon_dev).
echo Runs only when NODE_ENV=development and refuses any production-like database.
echo No Docker image build by default (Docker Hub base-image pulls can 403 here).
echo.

rem Optional explicit image build only if "--build" is passed. The seeder ignores --build.
set BUILD_IMAGE=0
echo %* | findstr /C:"--build" >nul && set BUILD_IMAGE=1

echo [1/5] Starting containers ^(no image build^)...
if "!BUILD_IMAGE!"=="1" (
  docker compose up -d --build
) else (
  docker compose up -d
)
if errorlevel 1 goto err_start

echo [2/5] Building API TypeScript on the Windows host...
call npm run build --workspace @dragon/api
if errorlevel 1 goto err_build

echo [3/5] Copying compiled dist into the running API container...
docker compose cp apps/api/dist/. api:/app/apps/api/dist/
if errorlevel 1 goto err_copy

echo [4/5] Applying database migrations...
docker compose exec -T api node /app/apps/api/dist/migrate.js
if errorlevel 1 goto err_migrate

echo [5/5] Seeding demo data...
docker compose exec -T api node /app/apps/api/dist/seed-demo.js %*
if errorlevel 1 goto err_seed

echo.
echo ========================================
echo Demo data ready.
echo.
echo Open:  http://localhost:8080
echo.
echo Sign in with any demo mobile listed in DEMO_DATA.md. Request the one-time code
echo through the normal sign-in screen first, then read it from the dev SMS inbox
echo (see DEMO_DATA.md) - no real SMS is sent and no code is printed here.
echo.
echo To refresh only the recreatable demo content:  SEED-DEMO.bat --reset --confirm
echo ========================================
echo.
pause
exit /b 0

:err_start
echo.
echo FAILED at step 1 (start containers). Is Docker Desktop running?
goto fail
:err_build
echo.
echo FAILED at step 2 (host TypeScript build). Run: npm install, then retry.
goto fail
:err_copy
echo.
echo FAILED at step 3 (copy dist into the api container). Is the api service running?
goto fail
:err_migrate
echo.
echo FAILED at step 4 (migrations).
goto fail
:err_seed
echo.
echo FAILED at step 5 (seeding). If it refused: the API must be development mode on
echo the dragon_dev database - re-run Dragon.bat, then retry.
goto fail

:fail
echo.
pause
exit /b 1
