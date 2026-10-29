@echo off
chcp 65001 > nul
title WhatsApp Bot - სერვერი

echo ==========================================
echo  WhatsApp Bot - სერვერის გაშვება
echo ==========================================
echo.

:: Node.js-ის გზის მიმითება ყოველ შემთხვევისთვის
set "PATH=%ProgramFiles%\nodejs\;%PATH%"

:: ვამოწმებთ Node.js-ის არსებობას
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [X] შეცდომა: Node.js ვერ მოიძებნა.
    echo გთხოვთ, ჯერ გაუშვათ install.bat ფაილი!
    echo.
    pause
    exit
)

echo [!] ბრაუზერის გახსნა...
start http://localhost:3000

echo [!] სერვერი გაეშვა მისამართზე http://localhost:3000
echo [!] სერვერის გასათიშად უბრალოდ დახურეთ ეს ფანჯარა.
echo.

node server.js
pause