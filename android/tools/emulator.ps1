# Les tests sur emulateur, depuis ce PC (voir android/README.md, « Tester sur emulateur »).
#
#   powershell -File android\tools\emulator.ps1                       # tout, sur Android 14
#   powershell -File android\tools\emulator.ps1 -Avd fgc-api30 -Port 5556   # sur Android 11
#   powershell -File android\tools\emulator.ps1 -GradleArgs connectedDebugAndroidTest,"-Pandroid.testInstrumentationRunnerArguments.class=io.github.diaslamka.freegames.IncomingDeviceTest"
#
# Demarre l'appareil virtuel s'il ne tourne pas (sans fenetre), attend la fin de son demarrage, puis lance Gradle contre LUI SEUL :
# ANDROID_SERIAL est pose, parce que Gradle installe l'appli avant les tests -- et un telephone branche aurait sa vraie appli
# remplacee (et ses donnees effacees). Les tests eux-memes refusent de tourner ailleurs que sur un emulateur (EmulatorOnly).
param(
    [string]$Avd = 'fgc-api34',
    [int]$Port = 5554,
    [string[]]$GradleArgs = @('connectedDebugAndroidTest')
)

$ErrorActionPreference = 'Stop'
$root = Join-Path $env:USERPROFILE 'android-dev'
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = Join-Path $root 'jdk-17' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $root 'sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
$emulator = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
$serial = "emulator-$Port"

function Test-Running { [bool]((& $adb devices) -match "^$([regex]::Escape($serial))\s+device") }

if (-not (Test-Running)) {
    if (-not ((& $emulator -list-avds) -contains $Avd)) { throw "L'appareil virtuel '$Avd' n'existe pas (voir android/README.md)." }
    Write-Host "Demarrage de $Avd sur le port $Port..."
    Start-Process -FilePath $emulator -WindowStyle Hidden -ArgumentList @(
        '-avd', $Avd, '-port', $Port, '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-no-snapshot-save')
    $waited = 0
    do {
        Start-Sleep 5; $waited += 5
        $booted = (Test-Running) -and ((& $adb -s $serial shell getprop sys.boot_completed 2>$null) -match '1')
    } until ($booted -or $waited -ge 300)
    if (-not $booted) { throw "$Avd n'a pas fini de demarrer en 5 minutes." }
}

$env:ANDROID_SERIAL = $serial
Set-Location (Join-Path $PSScriptRoot '..')
& .\gradlew.bat @GradleArgs --console=plain
exit $LASTEXITCODE
