<#
  Met a jour le dossier de l'extension depuis GitHub -- sans jamais rien ecraser.

  L'extension chargee depuis ce dossier ("Charger l'extension non empaquetee")
  ne se met pas a jour toute seule. Ce script fait le "git pull" ; l'extension
  voit ensuite la nouvelle version sur le disque et se recharge d'elle-meme
  (watch/self-update.js).

  TROIS DECLENCHEURS, en plus de l'appel a la main (2.54.0) :
    - toutes les heures : une tache planifiee de Windows ;
    - a l'ouverture de session, puis DES QU'UNE VERSION EST PUBLIEE : un petit
      ecouteur demarre avec la session, fait une mise a jour, puis attend une
      sonnette sur un sujet ntfy que GitHub fait retentir apres chaque check
      reussi sur main (.github/workflows/check.yml, secret MAJ_NTFY) ;
    - le bouton "Mettre a jour maintenant" du popup : l'extension appelle ce
      script par la messagerie native de Chrome (mode -Hote).

  Utilisation, depuis le dossier de l'extension :

    powershell -ExecutionPolicy Bypass -File tools\maj-auto.ps1
        une mise a jour, tout de suite

    powershell -ExecutionPolicy Bypass -File tools\maj-auto.ps1 -Installer
        installe les trois declencheurs, a votre nom, sans droits
        d'administrateur. -IdExtension <id> si le bouton du popup dit que le
        relais ne connait pas l'extension.

    powershell -ExecutionPolicy Bypass -File tools\maj-auto.ps1 -Desinstaller
        retire tout ce que -Installer a pose

  CE QU'IL NE FAIT JAMAIS :
    - ecraser un fichier modifie a la main : il le signale et s'arrete ;
    - forcer un historique qui a diverge de GitHub : il dit la commande a
      lancer, et vous la lancez vous-meme si c'est bien ce que vous voulez ;
    - changer de branche ;
    - executer quoi que ce soit venu du reseau ou de l'extension : la sonnette
      ntfy et le message du popup ne portent aucune commande. Ils declenchent
      la meme mise a jour que l'appel a la main, et rien d'autre.

  Journal : %LOCALAPPDATA%\FreeGamesAutoClaimer\maj-auto.log (200 lignes).

  Fichier en ASCII pur : Windows PowerShell 5.1 lit un script sans BOM dans
  la page de code de la machine, et les accents y deviendraient illisibles.
#>
param(
  [switch]$Installer,
  [switch]$Desinstaller,
  [switch]$Silencieux,
  [switch]$Hote,
  [switch]$Ecouter,
  [string[]]$IdExtension = @()
)

# 'Continue' et non 'Stop' : git ecrit sa progression sur stderr, et
# PowerShell 5.1 ferait de chaque ligne une erreur fatale. Les codes de
# retour sont verifies un par un.
$ErrorActionPreference = 'Continue'

# En relais comme en ecoute, personne ne lit la console -- et en relais, la
# sortie standard appartient a Chrome : un seul caractere de trop et le
# message est illisible.
if ($Hote -or $Ecouter) { $Silencieux = [switch]$true }

$Depot = Split-Path -Parent $PSScriptRoot
$Programme = Join-Path $PSScriptRoot 'maj-auto.ps1'
$Branche = 'main'
$Tache = 'Free Games Auto-Claimer - mise a jour'
$NomHote = 'com.free_games_claimer.maj'
$CleDemarrage = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$NomDemarrage = 'FreeGamesAutoClaimer-maj'
$ClesHotes = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
  'HKCU:\Software\Chromium\NativeMessagingHosts'
)
$Base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [System.IO.Path]::GetTempPath() }
$Dossier = Join-Path $Base 'FreeGamesAutoClaimer'
$Journal = Join-Path $Dossier 'maj-auto.log'
$FichierSujet = Join-Path $Dossier 'sujet.txt'

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

function EcrireFichier([string]$Chemin, [string]$Texte, $Encodage) {
  [System.IO.File]::WriteAllText($Chemin, $Texte, $Encodage)
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

<# ------------------------------------------------------------ la mise a jour

   Rend { Code, Etat, Avant, Apres, Detail }. L'etat est un mot fixe, que le
   popup traduit ; le detail est la phrase du journal. #>
function MettreAJour {
  $avant = Version
  function Fin([int]$Code, [string]$Etat, [string]$Texte) {
    Ecrire $Texte
    return @{ Code = $Code; Etat = $Etat; Avant = $avant; Apres = (Version); Detail = $Texte }
  }

  if (-not (Get-Command git -CommandType Application -ErrorAction SilentlyContinue)) {
    return Fin 2 'sans-git' 'git introuvable : installez Git for Windows (https://git-scm.com).'
  }
  if (-not (Test-Path (Join-Path $Depot '.git'))) { return Fin 2 'pas-depot' "pas un depot git : $Depot" }

  # Trois declencheurs peuvent tomber en meme temps ; git, lui, n'accepte
  # qu'une ecriture a la fois.
  $verrou = New-Object System.Threading.Mutex($false, 'Local\FreeGamesAutoClaimer-maj')
  $tenu = $false
  try { $tenu = $verrou.WaitOne(120000) } catch [System.Threading.AbandonedMutexException] { $tenu = $true }
  if (-not $tenu) { return Fin 1 'occupe' 'une autre mise a jour est en cours.' }
  try {
    $b = AppelGit rev-parse --abbrev-ref HEAD
    if ($b.Sortie -ne $Branche) {
      return Fin 1 'branche' "le dossier est sur la branche '$($b.Sortie)', pas '$Branche' : rien fait."
    }

    $etat = AppelGit status --porcelain --untracked-files=no
    if ($etat.Code -ne 0) { return Fin 1 'echec' "etat du depot illisible : $($etat.Sortie)" }
    if ($etat.Sortie) { return Fin 1 'modifie' ("fichiers modifies a la main, rien n'est ecrase :`n" + $etat.Sortie) }

    $f = AppelGit fetch --quiet origin $Branche
    if ($f.Code -ne 0) { return Fin 1 'reseau' "GitHub injoignable (reseau ?) : $($f.Sortie)" }

    $local = (AppelGit rev-parse HEAD).Sortie
    $distant = (AppelGit rev-parse "origin/$Branche").Sortie
    if ($local -eq $distant) { return Fin 0 'a-jour' "deja a jour ($avant)." }

    $ancetre = AppelGit merge-base --is-ancestor HEAD "origin/$Branche"
    if ($ancetre.Code -ne 0) {
      return Fin 1 'divergent' ("l'historique local differe de GitHub : rien fait. Si vous n'avez rien a garder dans ce dossier, " +
        "lancez une fois : git fetch   puis   git reset --hard origin/$Branche")
    }

    $m = AppelGit merge --ff-only --quiet "origin/$Branche"
    if ($m.Code -ne 0) { return Fin 1 'echec' "mise a jour refusee par git : $($m.Sortie)" }
    return Fin 0 'mis-a-jour' "mis a jour : $avant -> $(Version) ($($distant.Substring(0, 7))). L'extension se rechargera d'elle-meme."
  } finally {
    $verrou.ReleaseMutex()
  }
}

<# ------------------------------------------------------------ le relais (-Hote)

   La messagerie native de Chrome : quatre octets de longueur, puis du JSON,
   sur l'entree et la sortie standard. Un seul message attendu, { cmd: 'maj' } ;
   tout autre est refuse sans rien faire. #>
function LireMessage {
  $entree = [Console]::OpenStandardInput()
  $tete = New-Object byte[] 4
  $lu = 0
  while ($lu -lt 4) { $n = $entree.Read($tete, $lu, 4 - $lu); if ($n -le 0) { return $null }; $lu += $n }
  $taille = [BitConverter]::ToInt32($tete, 0)
  if ($taille -le 0 -or $taille -gt 4096) { return $null }
  $corps = New-Object byte[] $taille
  $lu = 0
  while ($lu -lt $taille) { $n = $entree.Read($corps, $lu, $taille - $lu); if ($n -le 0) { return $null }; $lu += $n }
  try { return ([System.Text.Encoding]::UTF8.GetString($corps) | ConvertFrom-Json) } catch { return $null }
}

function EcrireMessage($Objet) {
  $octets = [System.Text.Encoding]::UTF8.GetBytes(($Objet | ConvertTo-Json -Compress))
  $sortie = [Console]::OpenStandardOutput()
  $sortie.Write([BitConverter]::GetBytes([int]$octets.Length), 0, 4)
  $sortie.Write($octets, 0, $octets.Length)
  $sortie.Flush()
}

function ServirHote {
  $m = LireMessage
  if (-not $m -or $m.cmd -ne 'maj') {
    EcrireMessage @{ ok = $false; etat = 'refuse' }
    return 1
  }
  Ecrire 'demande du popup.'
  $r = MettreAJour
  EcrireMessage @{ ok = ($r.Code -eq 0); etat = $r.Etat; avant = $r.Avant; apres = $r.Apres; detail = $r.Detail }
  return 0
}

<# ------------------------------------------------------------ l'ecouteur (-Ecouter)

   Demarre avec la session : une mise a jour tout de suite, puis l'attente de
   la sonnette. Le sujet ntfy est un nom au hasard, garde dans sujet.txt ;
   le contenu d'un message n'est jamais lu, seulement sa presence. #>
function LireSujet {
  if (-not (Test-Path $FichierSujet)) { return $null }
  $s = (Get-Content -Path $FichierSujet -Raw).Trim()
  if ($s -match '^https://[A-Za-z0-9.-]+(:\d+)?/[A-Za-z0-9_-]{1,64}$') { return $s }
  return $null
}

function Ecouter {
  $seul = New-Object System.Threading.Mutex($false, 'Local\FreeGamesAutoClaimer-maj-ecoute')
  $tenu = $false
  try { $tenu = $seul.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $tenu = $true }
  if (-not $tenu) { return 0 }

  Ecrire 'ouverture de session.'
  MettreAJour | Out-Null

  $sujet = LireSujet
  if (-not $sujet) { Ecrire 'aucun sujet ntfy : pas de sonnette, seulement la mise a jour horaire.'; return 0 }

  # ntfy.sh n'accepte que TLS 1.2 et plus ; PowerShell 5.1 ne le propose pas
  # toujours de lui-meme.
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  $attente = 5
  $derniere = [DateTime]::MinValue
  $sonne = $false
  while ($true) {
    try {
      $requete = [System.Net.HttpWebRequest]::Create("$sujet/json")
      $requete.Timeout = 30000
      # ntfy envoie un signe de vie toutes les 45 s : deux minutes sans rien,
      # la connexion est morte, on la refait.
      $requete.ReadWriteTimeout = 120000
      $reponse = $requete.GetResponse()
      $lecteur = New-Object System.IO.StreamReader($reponse.GetResponseStream())
      $attente = 5
      while ($null -ne ($ligne = $lecteur.ReadLine())) {
        $evenement = $null
        try { $evenement = $ligne | ConvertFrom-Json } catch { }
        if ($evenement -and $evenement.event -eq 'message') { $sonne = $true }
        # Une mise a jour par minute au plus : deux publications rapprochees
        # en font une seule, faite apres la seconde.
        if ($sonne -and ((Get-Date) - $derniere).TotalSeconds -ge 60) {
          $sonne = $false
          $derniere = Get-Date
          Ecrire 'sonnette : une version vient d''etre publiee.'
          MettreAJour | Out-Null
        }
      }
      $reponse.Close()
    } catch {
      Start-Sleep -Seconds $attente
      $attente = [Math]::Min(300, $attente * 2)
    }
  }
}

<# ------------------------------------------------------------ l'installation #>

<# L'identifiant qu'une extension chargee depuis un dossier recoit de Chrome :
   les 16 premiers octets du SHA-256 du chemin (en UTF-16 sous Windows, lettre
   de lecteur en majuscule), chaque demi-octet ecrit de 'a' a 'p'. #>
function IdPourChemin([string]$Chemin) {
  $c = $Chemin.TrimEnd('\')
  if ($c.Length -ge 2 -and $c[1] -eq ':') { $c = $c.Substring(0, 1).ToUpper() + $c.Substring(1) }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $h = $sha.ComputeHash([System.Text.Encoding]::Unicode.GetBytes($c))
  $id = ''
  for ($i = 0; $i -lt 16; $i++) { $id += [string][char](97 + ($h[$i] -shr 4)) + [string][char](97 + ($h[$i] -band 15)) }
  return $id
}

<# Et ce que les profils Chrome, Edge ou Chromium en disent vraiment : on
   cherche ce dossier dans leurs Preferences, et l'identifiant qui le porte. #>
function IdsDesProfils {
  $ids = @()
  $cible = '"path":"' + $Depot.TrimEnd('\').Replace('\', '\\') + '"'
  $racines = @('Google\Chrome\User Data', 'Microsoft\Edge\User Data', 'Chromium\User Data')
  foreach ($r in $racines) {
    $dossierProfils = Join-Path $Base $r
    if (-not (Test-Path $dossierProfils)) { continue }
    foreach ($profil in @(Get-ChildItem -Path $dossierProfils -Directory -ErrorAction SilentlyContinue)) {
      foreach ($nom in @('Secure Preferences', 'Preferences')) {
        $fichier = Join-Path $profil.FullName $nom
        if (-not (Test-Path $fichier)) { continue }
        $texte = $null
        try { $texte = [System.IO.File]::ReadAllText($fichier) } catch { continue }
        $i = $texte.IndexOf($cible, [StringComparison]::OrdinalIgnoreCase)
        while ($i -ge 0) {
          $trouves = [regex]::Matches($texte.Substring(0, $i), '"([a-p]{32})":\{')
          if ($trouves.Count -gt 0) { $ids += $trouves[$trouves.Count - 1].Groups[1].Value }
          $i = $texte.IndexOf($cible, $i + 1, [StringComparison]::OrdinalIgnoreCase)
        }
      }
    }
  }
  return $ids
}

function NouveauSujet {
  $alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  $octets = New-Object byte[] 20
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($octets)
  $nom = ''
  foreach ($o in $octets) { $nom += $alphabet[$o % 32] }
  return "https://ntfy.sh/fgc-maj-$nom"
}

function Lanceur([string]$Nom, [string]$Argument) {
  # Un lanceur sans fenetre : lance directement, PowerShell ouvrirait une
  # console noire. En UTF-16 : wscript le lit ainsi, et un chemin accentue
  # (C:\Users\Helene...) y survit.
  $chemin = Join-Path $Dossier $Nom
  $commande = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""' + $Programme + '"" ' + $Argument
  $texte = "' Genere par tools\maj-auto.ps1 -Installer.`r`n" + 'CreateObject("WScript.Shell").Run "' + $commande + '", 0, False' + "`r`n"
  EcrireFichier $chemin $texte ([System.Text.Encoding]::Unicode)
  return $chemin
}

function InstallerTout {
  if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
    Ecrire 'le Planificateur de taches de Windows est introuvable : ce script ne tourne que sous Windows.'
    return 2
  }
  if (-not (Test-Path $Dossier)) { New-Item -ItemType Directory -Path $Dossier -Force | Out-Null }

  # 1. Toutes les heures.
  $horaire = Lanceur 'maj-auto-silencieux.vbs' '-Silencieux'
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $horaire + '"')
  $declencheur = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1)
  $reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $Tache -Action $action -Trigger $declencheur -Settings $reglages -Force `
    -Description "git pull de $Depot, toutes les heures. Retirer : tools\maj-auto.ps1 -Desinstaller" | Out-Null
  Ecrire 'declencheur 1/3 : toutes les heures (tache planifiee).'

  # 2. A l'ouverture de session, puis a chaque version publiee. La cle Run de
  #    l'utilisateur plutot qu'un declencheur "a l'ouverture de session" de
  #    la tache : celui-la demande souvent des droits d'administrateur.
  if (-not (LireSujet)) { EcrireFichier $FichierSujet (NouveauSujet) (New-Object System.Text.UTF8Encoding($false)) }
  $ecoute = Lanceur 'maj-ecoute.vbs' '-Ecouter'
  New-ItemProperty -Path $CleDemarrage -Name $NomDemarrage -Value ('wscript.exe "' + $ecoute + '"') -PropertyType String -Force | Out-Null
  Ecrire 'declencheur 2/3 : a l''ouverture de session, puis a chaque version publiee (ecouteur ntfy).'

  # 3. Le bouton du popup : le relais de messagerie native.
  $bat = Join-Path $Dossier 'maj-hote.bat'
  $texteBat = "@echo off`r`npowershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Programme`" -Hote`r`n"
  # cmd lit un .bat dans la page de code OEM : c'est dans celle-la qu'un
  # chemin accentue doit etre ecrit pour survivre.
  EcrireFichier $bat $texteBat ([System.Text.Encoding]::GetEncoding((Get-Culture).TextInfo.OEMCodePage))

  $ids = @(@($IdExtension) + @(IdsDesProfils) + @(IdPourChemin $Depot) | Where-Object { $_ -match '^[a-p]{32}$' } | Select-Object -Unique)
  $manifeste = [ordered]@{
    name = $NomHote
    description = 'Free Games Auto-Claimer : mise a jour du dossier de l''extension'
    path = $bat
    type = 'stdio'
    allowed_origins = @($ids | ForEach-Object { "chrome-extension://$_/" })
  }
  $json = Join-Path $Dossier "$NomHote.json"
  EcrireFichier $json ($manifeste | ConvertTo-Json) (New-Object System.Text.UTF8Encoding($false))
  foreach ($cle in $ClesHotes) {
    $k = Join-Path $cle $NomHote
    New-Item -Path $k -Force | Out-Null
    Set-Item -Path $k -Value $json
  }
  Ecrire ("declencheur 3/3 : le bouton du popup (relais ouvert a l'extension " + ($ids -join ', ') + ').')

  # L'ecouteur demarre tout de suite, sans attendre la prochaine session.
  Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + $ecoute + '"')

  $sujet = LireSujet
  Ecrire 'Derniere etape, sur GitHub, pour la mise a jour des la publication :'
  Ecrire '  depot -> Settings -> Secrets and variables -> Actions -> New repository secret'
  Ecrire "  nom : MAJ_NTFY      valeur : $sujet"
  Ecrire "journal : $Journal"
  return 0
}

function DesinstallerTout {
  if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
    if (Get-ScheduledTask -TaskName $Tache -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $Tache -Confirm:$false
      Ecrire "tache '$Tache' retiree."
    }
  }
  if (Get-ItemProperty -Path $CleDemarrage -Name $NomDemarrage -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $CleDemarrage -Name $NomDemarrage
    Ecrire 'demarrage avec la session retire.'
  }
  foreach ($cle in $ClesHotes) {
    $k = Join-Path $cle $NomHote
    if (Test-Path $k) { Remove-Item -Path $k -Force }
  }
  Ecrire 'relais du popup retire.'
  # L'ecouteur en cours : on l'arrete, lui et lui seul.
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue)) {
    if ($p.CommandLine -and $p.CommandLine -like '*maj-auto.ps1*-Ecouter*') { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  foreach ($f in @('maj-auto-silencieux.vbs', 'maj-ecoute.vbs', 'maj-hote.bat', "$NomHote.json")) {
    $chemin = Join-Path $Dossier $f
    if (Test-Path $chemin) { Remove-Item $chemin -Force }
  }
  Ecrire "sujet ntfy conserve ($FichierSujet) : une reinstallation garde le meme, et le secret GitHub reste bon."
  return 0
}

if ($Hote) { exit (ServirHote) }
if ($Ecouter) { exit (Ecouter) }
if ($Desinstaller) { exit (DesinstallerTout) }
if ($Installer) {
  $code = InstallerTout
  if ($code -ne 0) { exit $code }
}
exit (MettreAJour).Code
