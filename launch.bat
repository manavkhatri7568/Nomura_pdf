@echo off
REM ============================================================
REM  launch.bat - start the whole Agentic Workflows stack
REM    1) Mock Microsoft Graph API   :8001
REM    2) Agent API (FastAPI)        :8000   (GRAPH_BASE_URL -> mock)
REM    3) Frontend (Next.js dev)     :3000
REM
REM  Each service runs in its own window. Close a window (or press
REM  Ctrl+C in it) to stop that service. Double-click this file, or
REM  run "launch.bat" from a terminal in this folder.
REM ============================================================
setlocal

REM --- project root = the folder this script lives in (strip trailing slash) ---
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

REM --- the Agent API talks to the mock Graph; child windows inherit this ---
set "GRAPH_BASE_URL=http://localhost:8001"

echo ============================================================
echo   Agentic Workflows - launching all services
echo   root: %ROOT%
echo ============================================================

REM --- first run only: install Python deps if FastAPI isn't importable ---
set "PYTHON=python"
if exist "%ROOT%\venv\Scripts\python.exe" (
  set "PYTHON=%ROOT%\venv\Scripts\python.exe"
)

"%PYTHON%" -c "import fastapi, uvicorn, httpx" 1>nul 2>nul
if errorlevel 1 (
  echo.
  echo [setup] installing Python dependencies ^(first run only^)...
  "%PYTHON%" -m pip install -r "%ROOT%\requirements.txt"
)

REM --- first run only: install frontend deps if node_modules is missing ---
if not exist "%ROOT%\frontend\node_modules" (
  echo.
  echo [setup] installing frontend dependencies ^(first run only^)...
  pushd "%ROOT%\frontend"
  call npm install
  popd
)

REM --- ensure the sample attachment emails are in the inbox ---
REM   These carry the .xlsx/.csv trade blotters the Extract step parses. A test
REM   run or inbox regenerate wipes the inbox, so restore them on every launch
REM   (idempotent copy; the pipeline dedups already-processed emails).
if exist "%ROOT%\data\sample_emails_with_attachments\*.eml" (
  copy /y "%ROOT%\data\sample_emails_with_attachments\*.eml" "%ROOT%\data\raw_emails\inbox\" >nul
)

echo.
echo Starting services in separate windows...
echo Using Python: %PYTHON%

REM --- 1) Mock Microsoft Graph API on :8001 ---
start "Mock Graph API :8001" /d "%ROOT%" cmd /k ""%PYTHON%"" -m uvicorn mock_graph.app:app --port 8001

REM --- 2) Agent API on :8000 (inherits GRAPH_BASE_URL) ---
start "Agent API :8000" /d "%ROOT%" cmd /k ""%PYTHON%"" -m uvicorn api.app:app --port 8000

REM --- 3) Frontend (Next.js dev server) on :3000 ---
start "Frontend :3000" /d "%ROOT%\frontend" cmd /k npm run dev

REM --- give the dev server a head start, then open the browser ---
echo.
echo Waiting for the frontend to compile, then opening http://localhost:3000 ...
echo (If the page is not ready yet, just refresh it in a few seconds.)
timeout /t 10 /nobreak >nul
start "" http://localhost:3000

echo.
echo All services launched. Close the three windows to stop everything.
endlocal
