<#
  Met a jour le dossier de l'extension depuis GitHub -- sans jamais rien ecraser.

  L'extension chargee depuis ce dossier ("Charger l'extension non empaquetee")
  ne se met pas a jour toute seule. Ce script fait le "git pull" ; l'extension
  voit ensuite la nouvelle version sur le disque et se recharge d'elle-meme
  dans les cinq minutes (watch/self-update.js).

  Utilisation, depuis le dossier de l'extension :

    powershell -ExecutionPolicy Bypass -File tools\maj-auto.ps1
        une mise a jour, tout de suite

    powershell -ExecutionPolicy Bypass -File tools\maj-auto.ps1 -Installer
        toutes les heures, en silence (tache planifiee de Windows, a votre nom,
        sans droits d'administrateur)

    powershell -ExecutionPolicy Bypass -File tools\maj-auto.ps1 -Desinstaller
        retire la tache planifiee

  CE QU'IL NE FAIT JAMAIS :
    - ecraser un fichier modifie a la main : il le signale et s'arrete ;
    - forcer un historique qui a diverge de GitHub : il dit la commande a
      lancer, et vous la lancez vous-meme si c'est bien ce que vous voulez ;
    - changer de branche.

  Journal : %LOCALAPPDATA%\FreeGamesAutoClaimer\maj-auto.log (200 lignes).

  Fichier en ASCII pur : Windows PowerShell 5.1 lit un script sans BOM dans
  la page de code de la machine, et les accents y deviendraient illisibles.
#>
param(
  [switch]$Installer,
  [switch]$Desinstaller,
  [switch]$Silencieux
)

# 'Continue' et non 'Stop' : git ecrit sa progression sur stderr, et
# PowerShell 5.1 ferait de chaque ligne une erreur fatale. Les codes de
# retour sont verifies un par un.
$ErrorActionPreference = 'Continue'

$Depot = Split-Path -Parent $PSScriptRoot
$Branche = 'main'
$Tache = 'Free Games Auto-Claimer - mise a jour'
$Base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [System.IO.Path]::GetTempPath() }
$Dossier = Join-Path $Base 'FreeGamesAutoClaimer'
$Journal = Join-Path $Dossier 'maj-auto.log'

function Ecrire([string]$Texte) {
  $ligne = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Texte
  if (-not $Silencieux) { Write-Host $ligne }
  try {
    if (-not (Test-Path $Dossier)) { New-Item -ItemType Directory -Path $Dossier -Force | Out-Null }
    Add-Content -Path $Journal -Value $ligne -Encoding UTF8
    $lignes = @(Get-Content -Path $Journal -Encoding UTF8)
    if ($lignes.Count -gt 400) { $lignes | Select-Object -Last 200 | Set-Content -Path $Journal -Encoding UTF8 }
  } catch { }
}

# Pas "function Git" : une fonction masque la commande du meme nom, et
# l'appel a git ci-dessous se serait appele lui-meme.
function AppelGit {
  $sortie = & git -C $Depot @args 2>&1
  return @{ Code = $LASTEXITCODE; Sortie = (($sortie | ForEach-Object { "$_" }) -join "`n").Trim() }
}

function Version {
  try { return (Get-Content -Path (Join-Path $Depot 'manifest.json') -Raw | ConvertFrom-Json).version } catch { return '?' }
}

function MettreAJour {
  if (-not (Get-Command git -CommandType Application -ErrorAction SilentlyContinue)) {
    Ecrire 'git introuvable : installez Git for Windows (https://git-scm.com).'
    return 2
  }
  if (-not (Test-Path (Join-Path $Depot '.git'))) {
    Ecrire "pas un depot git : $Depot"
    return 2
  }

  $b = AppelGit rev-parse --abbrev-ref HEAD
  if ($b.Sortie -ne $Branche) {
    Ecrire "le dossier est sur la branche '$($b.Sortie)', pas '$Branche' : rien fait."
    return 1
  }

  $etat = AppelGit status --porcelain --untracked-files=no
  if ($etat.Code -ne 0) { Ecrire "etat du depot illisible : $($etat.Sortie)"; return 1 }
  if ($etat.Sortie) {
    Ecrire ("fichiers modifies a la main, rien n'est ecrase :`n" + $etat.Sortie)
    return 1
  }

  $f = AppelGit fetch --quiet origin $Branche
  if ($f.Code -ne 0) { Ecrire "GitHub injoignable (reseau ?) : $($f.Sortie)"; return 1 }

  $local = (AppelGit rev-parse HEAD).Sortie
  $distant = (AppelGit rev-parse "origin/$Branche").Sortie
  if ($local -eq $distant) { Ecrire "deja a jour ($(Version))."; return 0 }

  $ancetre = AppelGit merge-base --is-ancestor HEAD "origin/$Branche"
  if ($ancetre.Code -ne 0) {
    Ecrire ("l'historique local differe de GitHub : rien fait. Si vous n'avez rien a garder dans ce dossier, " +
      "lancez une fois : git fetch   puis   git reset --hard origin/$Branche")
    return 1
  }

  $avant = Version
  $m = AppelGit merge --ff-only --quiet "origin/$Branche"
  if ($m.Code -ne 0) { Ecrire "mise a jour refusee par git : $($m.Sortie)"; return 1 }
  Ecrire "mis a jour : $avant -> $(Version) ($($distant.Substring(0, 7))). L'extension se rechargera d'elle-meme."
  return 0
}

function InstallerTache {
  if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
    Ecrire 'le Planificateur de taches de Windows est introuvable.'
    return 2
  }
  if (-not (Test-Path $Dossier)) { New-Item -ItemType Directory -Path $Dossier -Force | Out-Null }

  # Un lanceur sans fenetre : lancee directement, la tache ouvrirait une
  # console noire toutes les heures. En UTF-16 : wscript le lit ainsi, et un
  # chemin accentue (C:\Users\Helene...) y survit.
  $lanceur = Join-Path $Dossier 'maj-auto-silencieux.vbs'
  $chemin = Join-Path $PSScriptRoot 'maj-auto.ps1'
  $commande = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""' + $chemin + '"" -Silencieux'
  @(
    "' Genere par tools\maj-auto.ps1 -Installer : lance la mise a jour sans fenetre.",
    ('CreateObject("WScript.Shell").Run "' + $commande + '", 0, False')
  ) | Set-Content -Path $lanceur -Encoding Unicode

  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $lanceur + '"')
  $declencheur = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1)
  $reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $Tache -Action $action -Trigger $declencheur -Settings $reglages -Force `
    -Description "git pull de $Depot, toutes les heures. Retirer : tools\maj-auto.ps1 -Desinstaller" | Out-Null

  Ecrire "tache '$Tache' installee : une mise a jour toutes les heures, la premiere dans une minute."
  Ecrire "journal : $Journal"
  return 0
}

function DesinstallerTache {
  if (Get-ScheduledTask -TaskName $Tache -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Tache -Confirm:$false
    Ecrire "tache '$Tache' retiree."
  } else {
    Ecrire "aucune tache '$Tache' a retirer."
  }
  $lanceur = Join-Path $Dossier 'maj-auto-silencieux.vbs'
  if (Test-Path $lanceur) { Remove-Item $lanceur -Force }
  return 0
}

if ($Desinstaller) { exit (DesinstallerTache) }
if ($Installer) {
  $code = InstallerTache
  if ($code -ne 0) { exit $code }
}
exit (MettreAJour)
