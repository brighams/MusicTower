@echo off
setlocal EnableDelayedExpansion

REM SteamMusicServer build environment -- Windows
REM
REM aws_lc_rs (rustls crypto) requires: MSVC build tools, cmake, nasm, perl
REM rusqlite uses bundled sqlite -- no system sqlite needed.
REM
REM Uses winget (built into Windows 11 / updated Windows 10).
REM Run this script from an elevated (Administrator) Command Prompt.

echo ==========================================================
echo  SteamMusicServer -- Windows Build Environment Setup
echo ==========================================================
echo.

REM ── Check for winget ──────────────────────────────────────
where winget >nul 2>&1
if errorlevel 1 (
    echo ERROR: winget not found.
    echo Install the App Installer from the Microsoft Store, then re-run.
    exit /b 1
)

REM ── Visual Studio Build Tools (MSVC) ──────────────────────
echo =^> Installing Visual Studio Build Tools (MSVC C++ workload^)
winget install --id Microsoft.VisualStudio.2022.BuildTools ^
    --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" ^
    --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo    Already installed or install failed -- continuing.
)

REM ── cmake ─────────────────────────────────────────────────
echo.
echo =^> Installing cmake
winget install --id Kitware.CMake --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo    Already installed or install failed -- continuing.
)

REM ── NASM ─────────────────────────────────────────────────
echo.
echo =^> Installing NASM (required by aws_lc_rs for asm optimizations^)
winget install --id NASM.NASM --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo    Already installed or install failed -- continuing.
)

REM ── Strawberry Perl ───────────────────────────────────────
echo.
echo =^> Installing Strawberry Perl
winget install --id StrawberryPerl.StrawberryPerl --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo    Already installed or install failed -- continuing.
)

REM ── rustup ────────────────────────────────────────────────
echo.
echo =^> Installing rustup
where rustup >nul 2>&1
if errorlevel 1 (
    winget install --id Rustlang.Rustup --accept-package-agreements --accept-source-agreements
) else (
    echo    rustup already installed, updating...
    rustup update stable
)

REM ── Refresh PATH and verify ────────────────────────────────
echo.
echo =^> Refreshing PATH...
REM Re-source environment by re-running from a fresh shell is best practice.
REM For now, attempt to add common paths.
set "PATH=%PATH%;%USERPROFILE%\.cargo\bin;C:\Program Files\NASM;C:\Strawberry\perl\bin;C:\Program Files\CMake\bin"

echo.
rustc --version 2>nul || echo    NOTE: rustc not in PATH yet -- open a new terminal before building.
cargo --version 2>nul || echo    NOTE: cargo not in PATH yet -- open a new terminal before building.

echo.
echo ==========================================================
echo  Done.
echo  IMPORTANT: Open a NEW terminal before running:
echo    cargo build --release
echo  cmake, NASM, and Perl must be on PATH for the build.
echo ==========================================================

endlocal
