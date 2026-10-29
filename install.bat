@echo off
chcp 65001 > nul
title WhatsApp Bot - ინსტალაცია

echo ==========================================
echo  WhatsApp Bot - პირველადი ინსტალაცია
echo ==========================================
echo.

:: ვამოწმებთ, აყენია თუ არა Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js არ არის ნაპოვნი. იწყება ავტომატური გადმოწერა...
    echo.
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi' -OutFile 'node_installer.msi'"
    
    echo [!] Node.js-ის ინსტალაცია... (გთხოვთ დაელოდოთ)
    msiexec /i node_installer.msi /qn /norestart
    del node_installer.msi
    
    echo [v] Node.js წარმატებით დაინსტალირდა!
    echo.
    set "PATH=%ProgramFiles%\nodejs\;%PATH%"
) else (
    echo [v] Node.js უკვე დაინსტალირებულია.
)

echo [!] პროექტის ბიბლიოთეკების დაყენება (npm install)...
echo.
call npm install

echo.
echo ==========================================
echo  🎉 ინსტალაცია წარმატებით დასრულდა!
echo  აპის გასაშვებად გახსენით start.bat
echo ==========================================
pause