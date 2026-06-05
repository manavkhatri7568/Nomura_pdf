@echo off
REM ============================================================
REM  stop.bat - stop the Agentic Workflows stack
REM    Frees the three service ports by terminating whatever is
REM    LISTENING on each:
REM       8001  Mock Microsoft Graph API
REM       8000  Agent API (FastAPI)
REM       3000  Frontend (Next.js dev)
REM    Safe to run anytime. Double-click it, or run "stop.bat".
REM ============================================================
echo ============================================================
echo   Agentic Workflows - stopping all services
echo ============================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($p in 8001,8000,3000) { $ids = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($ids) { foreach ($procId in $ids) { $n = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName; Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Host ('  port ' + $p + ' : stopped PID ' + $procId + ' (' + $n + ')') } } else { Write-Host ('  port ' + $p + ' : nothing listening') } }"

echo.
echo Done. The launch.bat windows may still be open (now idle) - you can close them.
timeout /t 3 /nobreak >nul
