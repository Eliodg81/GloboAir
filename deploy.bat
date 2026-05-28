@echo off
chcp 65001 >nul
title GloboAir Deploy

echo.
echo ╔══════════════════════════════════════╗
echo ║        GloboAir  Deploy Tool         ║
echo ╚══════════════════════════════════════╝
echo.

:: ── Versione ─────────────────────────────────────────────────────────────────
:: Modifica questo numero prima di fare deploy per identificare la build
set VERSION=v1.3
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set TODAY=%%a %%b %%c

echo  Versione : %VERSION%
echo  Data     : %date%
echo.

:: ── 1. Build ─────────────────────────────────────────────────────────────────
echo [1/5] npm run build...
call npm run build
if errorlevel 1 ( echo ERRORE nel build! & pause & exit /b 1 )
echo       OK
echo.

:: ── 2. Aggiorna versione nel sorgente ────────────────────────────────────────
echo [2/5] Aggiorno versione in ModeSelect.tsx...
powershell -Command "(Get-Content 'src\components\ModeSelect.tsx') -replace 'v\d+\.\d+ · \d+ \w+ \d+', '%VERSION% · %date%' | Set-Content 'src\components\ModeSelect.tsx'"
echo       OK
echo.

:: ── 3. Cap sync ──────────────────────────────────────────────────────────────
echo [3/5] Capacitor sync iOS + Android...
call npx cap sync ios  2>nul
call npx cap sync android 2>nul
echo       OK
echo.

:: ── 4. Ripristina BLEPeripheralPlugin in capacitor.config.json ───────────────
echo [4/5] Fix packageClassList iOS...
powershell -Command ^
  "$f='ios\\App\\App\\capacitor.config.json';" ^
  "$j=Get-Content $f -Raw | ConvertFrom-Json;" ^
  "if ($j.packageClassList -notcontains 'BLEPeripheralPlugin') {" ^
  "  $j.packageClassList += 'BLEPeripheralPlugin';" ^
  "  $j | ConvertTo-Json -Depth 10 | Set-Content $f -Encoding UTF8;" ^
  "  Write-Host '      Aggiunto BLEPeripheralPlugin';" ^
  "} else { Write-Host '      Gia presente' }"
echo       OK
echo.

:: ── 5. Git add + commit + push ───────────────────────────────────────────────
echo [5/5] Git commit e push...
git add -f ios/App/App/public/
git add -f ios/App/App/capacitor.config.json
git add -f android/app/src/main/assets/public/
git add src/
git add dist/

:: Messaggio commit automatico con versione
set MSG=deploy %VERSION% - %date% %time:~0,5%
git commit -m "%MSG%" --author="GloboAir Deploy <deploy@globoair.app>"
if errorlevel 1 (
  echo       Nessuna modifica da committare.
) else (
  git push origin master
  if errorlevel 1 ( echo ERRORE nel push! & pause & exit /b 1 )
  echo       Push completato!
)

echo.
echo ╔══════════════════════════════════════╗
echo ║   Deploy completato: %VERSION%         ║
echo ╚══════════════════════════════════════╝
echo.
echo  Su Mac:
echo    git pull origin master
echo    npx cap open ios
echo    Xcode: Shift+Cmd+K poi Run
echo.
echo  Su Android Studio:
echo    git pull origin master
echo    Run ▶
echo.
pause
