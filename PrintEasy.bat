@echo off
title PrintEasy Launcher
echo ==============================================
echo             STARTING PRINTEASY...
echo ==============================================
echo.

:: Check if 'py' works, otherwise fall back to 'python'
where py >nul 2>nul
if %errorlevel% equ 0 (
    set PY_CMD=py
) else (
    where python >nul 2>nul
    if %errorlevel% equ 0 (
        set PY_CMD=python
    ) else (
        echo ERROR: Python is not installed or not in your PATH!
        echo Please install Python and try again.
        pause
        exit /b
    )
)

echo 1. Launching Python backend server...
start /b %PY_CMD% server.py
echo.
echo 2. Waiting for server to initialize...
timeout /t 2 /nobreak >nul
echo.
echo 3. Opening PrintEasy in your default browser...
start http://localhost:5000
echo.
echo ==============================================
echo  PrintEasy is running!
echo  Leave this window open while using the app.
echo  To close the app, simply close this window.
echo ==============================================
echo.
pause
