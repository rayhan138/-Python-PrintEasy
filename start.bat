@echo off
echo Starting PrintEasy...
echo.
echo App will open in your browser at http://localhost:5000
echo Press Ctrl+C to stop the server.
echo.
timeout /t 2 /nobreak >nul
start http://localhost:5000
py server.py
