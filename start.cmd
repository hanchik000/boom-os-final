@echo off
REM One command from a fresh clone to a running BOOM OS (Windows).
setlocal
cd /d "%~dp0"

where docker >nul 2>&1
if errorlevel 1 (
  echo Docker is not installed or not in PATH: https://docs.docker.com/get-docker/
  exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is installed but not running. Start Docker Desktop and run this again.
  exit /b 1
)

echo [1/3] Configuration
REM Only .env generation needs Node, and the point of this path is that Docker is the single
REM install -- so without Node on PATH the same script runs inside the same image the build uses.
where node >nul 2>&1
if errorlevel 1 (
  echo ^(Node is not installed locally -- running the configuration step inside Docker^)
  docker run --rm -v "%cd%:/app" -w /app node:20-alpine node scripts/setup-env.mjs
) else (
  call node scripts\setup-env.mjs
)
if errorlevel 1 exit /b 1

echo.
echo [2/3] Build and start ^(first run downloads images and compiles -- several minutes^)
docker compose up -d --build
if errorlevel 1 exit /b 1

set "PORT=3000"
for /f "usebackq tokens=2 delims==" %%A in (`findstr /b "BOOM_OS_PORT=" .env`) do set "PORT=%%A"

echo.
echo [3/3] Waiting for the server to answer on port %PORT%
for /l %%i in (1,1,120) do (
  curl -fsS -m 2 "http://localhost:%PORT%/api/health" >nul 2>&1
  if not errorlevel 1 (
    echo.
    echo BOOM OS is running: http://localhost:%PORT%
    findstr /b "BOOTSTRAP_OWNER_EMAIL= BOOTSTRAP_OWNER_PASSWORD=" .env
    echo.
    echo   Logs:  docker compose logs -f api
    echo   Stop:  docker compose down          ^(data is kept^)
    echo   Reset: docker compose down -v       ^(database erased^)
    start "" "http://localhost:%PORT%"
    exit /b 0
  )
  timeout /t 2 /nobreak >nul
)

echo The server did not answer within four minutes. What it reported:
docker compose logs --tail 40 api
exit /b 1
