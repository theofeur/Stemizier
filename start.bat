@echo off
title Stemizer

echo Starting Stemizer...
echo.

:: Start backend
cd /d "%~dp0backend"
start "Stemizer Backend" cmd /k ".venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

:: Start frontend
cd /d "%~dp0frontend"
start "Stemizer Frontend" cmd /k "npm run dev"

echo Backend: http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Close the terminal windows to stop the servers.
pause
