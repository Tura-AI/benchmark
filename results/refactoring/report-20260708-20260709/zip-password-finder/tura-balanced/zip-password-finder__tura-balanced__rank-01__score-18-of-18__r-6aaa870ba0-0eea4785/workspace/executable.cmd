@echo off
py -3 "%~dp0zip_password_finder.py" %*
exit /b %ERRORLEVEL%
