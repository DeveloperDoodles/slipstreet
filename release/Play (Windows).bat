@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py serve.py & goto :eof)
where python >nul 2>nul && (python serve.py & goto :eof)
echo Slipstreet needs Python 3 to start. Install it from https://www.python.org/downloads/ (tick "Add to PATH"), then run this again.
pause
