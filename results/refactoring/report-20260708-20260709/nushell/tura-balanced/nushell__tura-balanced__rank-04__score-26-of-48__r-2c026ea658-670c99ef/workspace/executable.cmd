@echo off
setlocal
python "%~dp0nushell_port.py" %*
exit /b %ERRORLEVEL%
