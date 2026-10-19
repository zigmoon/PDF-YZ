# Compile l'application de bureau Windows sans Visual Studio.
#
#   pwsh -File scripts/build-windows-gnullvm.ps1
#
# Pourquoi ce script existe : la chaîne MSVC officielle n'est pas toujours
# installable (pas de droits administrateur, machine de test, conteneur). Une
# chaîne LLVM-MinGW suffit alors, mais elle demande trois ajustements que ce
# fichier fait à votre place :
#
#   1. la distribution Rust `x86_64-pc-windows-gnullvm` doit exister — un rustc
#      compilé pour MSVC refuse de se passer de `link.exe` ;
#   2. `rustc` lie `libunwind` en dynamique sur cette cible, ce qui obligerait à
#      livrer une DLL MinGW avec l'application. On fournit `libunwind.a` sous le
#      nom que le linker cherche, pour obtenir une liaison statique ;
#   3. `WebView2Loader` n'est lié statiquement que pour `target_env = "msvc"` :
#      en gnullvm, l'exécutable importe `WebView2Loader.dll`. Le profil
#      `src-tauri/tauri.gnullvm.json` l'embarque donc à côté de l'exécutable.
#
# Le CI ne passe pas par ici : les runners GitHub ont MSVC, et un binaire MSVC
# n'a besoin d'aucune DLL. Ce chemin reste un secours local.
#
# Ce qui n'est PAS résolu : la signature de code. L'installeur produit ici est un
# installeur de développement.

$ErrorActionPreference = 'Stop'

$desktop = Split-Path -Parent $PSScriptRoot
$srcTauri = Join-Path $desktop 'src-tauri'
$toolchain = 'stable-x86_64-pc-windows-gnullvm'

function Fail($message) {
    Write-Host "  x $message" -ForegroundColor Red
    exit 1
}

Write-Host "1/5  chaîne de compilation"

if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
    Fail "rustup introuvable : installer Rust depuis https://rustup.rs"
}

$installed = & rustup toolchain list
if ($installed -notmatch [regex]::Escape($toolchain)) {
    Write-Host "  distribution absente, installation ($toolchain)…"
    & rustup toolchain install $toolchain --profile minimal
    if ($LASTEXITCODE -ne 0) { Fail "installation de $toolchain impossible" }
}
Write-Host "  ok  $toolchain"

# clang est fourni par LLVM-MinGW. On accepte n'importe quel clang déjà présent
# dans le PATH, sinon on cherche une installation winget récente.
$clang = (Get-Command clang -ErrorAction SilentlyContinue)
if ($clang) {
    $clangBin = Split-Path -Parent $clang.Source
} else {
    $guess = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Directory -Filter 'MartinStorsjo.LLVM-MinGW*' -ErrorAction SilentlyContinue |
        ForEach-Object { Get-ChildItem $_.FullName -Directory -Filter 'llvm-mingw-*' -ErrorAction SilentlyContinue } |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if (-not $guess) {
        Fail "clang introuvable. Installer LLVM-MinGW : winget install MartinStorsjo.LLVM-MinGW.UCRT"
    }
    $clangBin = Join-Path $guess.FullName 'bin'
    $env:PATH = "$clangBin;$env:PATH"
}
Write-Host "  ok  clang  $clangBin"

$sysrootLib = Join-Path (Split-Path -Parent $clangBin) 'x86_64-w64-mingw32\lib\libunwind.a'
if (-not (Test-Path $sysrootLib)) {
    Fail "libunwind.a introuvable dans $sysrootLib"
}

Write-Host "2/5  bibliothèques statiques"

# `link(name = "unwind")` fait chercher `libunwind.dll.a` en priorité. Placer
# l'archive statique sous ce nom, dans un dossier ajouté à la recherche du
# linker, suffit : lld prend le premier fichier qui porte le nom demandé.
$stage = Join-Path $desktop 'build\gnullvm-libs'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item $sysrootLib (Join-Path $stage 'libunwind.dll.a') -Force
Write-Host "  ok  libunwind statique"

$loader = Join-Path $srcTauri 'target\release\WebView2Loader.dll'
$profile = Join-Path $srcTauri 'tauri.gnullvm.json'
if (-not (Test-Path $profile)) { Fail "profil absent : $profile" }

Write-Host "3/5  compilation (quelques minutes)"

$env:RUSTUP_TOOLCHAIN = $toolchain
# RUSTFLAGS doit rester identique d'une compilation à l'autre, sinon cargo
# reconstruit tout : c'est voulu, mais cela rend les reprises lentes.
$env:RUSTFLAGS = "-L native=$stage"

Push-Location $desktop
try {
    & npx --no-install tauri build --bundles nsis --config src-tauri/tauri.gnullvm.json
    if ($LASTEXITCODE -ne 0) { Fail "tauri build a echoue" }
} finally {
    Pop-Location
}

Write-Host "4/5  contrôles"

$exe = Join-Path $srcTauri 'target\release\pdfyz-desktop.exe'
$setup = Get-ChildItem (Join-Path $srcTauri 'target\release\bundle\nsis') -Filter '*setup.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not (Test-Path $exe)) { Fail "executable absent : $exe" }
if (-not (Test-Path $loader)) { Fail "WebView2Loader.dll absent : l'installeur serait muet" }
if (-not $setup) { Fail "installeur NSIS introuvable" }

# Un executable qui importerait une DLL MinGW échouerait sur une machine propre,
# alors qu'il fonctionne très bien sur la machine qui vient de le compiler — le
# PATH y contient la chaîne. On refuse ce cas plutôt que de le livrer.
$readobj = Join-Path $clangBin 'llvm-readobj.exe'
if (Test-Path $readobj) {
    $imports = (& $readobj --coff-imports $exe | Select-String 'Name:').Line -join "`n"
    $bad = @('libunwind.dll', 'libgcc_s_', 'libwinpthread-1.dll') | Where-Object { $imports -match [regex]::Escape($_) }
    if ($bad) { Fail "l'executable importe encore : $($bad -join ', ')" }
    Write-Host "  ok  aucune DLL de la chaîne de compilation dans les imports"
}
Write-Host "  ok  WebView2Loader.dll embarque"

Write-Host "5/5  copie vers dist-windows/"

$out = Join-Path $desktop 'dist-windows'
New-Item -ItemType Directory -Force -Path $out | Out-Null
Get-ChildItem $out -File | Remove-Item -Force
Copy-Item $setup.FullName (Join-Path $out $setup.Name) -Force
Copy-Item $exe (Join-Path $out 'pdfyz-desktop.exe') -Force
Copy-Item $loader (Join-Path $out 'WebView2Loader.dll') -Force

$portable = Join-Path $out 'PDF-YZ-portable.zip'
if (Test-Path $portable) { Remove-Item $portable -Force }
Compress-Archive -Path (Join-Path $out 'pdfyz-desktop.exe'), (Join-Path $out 'WebView2Loader.dll') -DestinationPath $portable

Write-Host ""
Write-Host "  installeur : $(Join-Path $out $setup.Name)"
Write-Host "  portable   : $portable"
Write-Host ""
