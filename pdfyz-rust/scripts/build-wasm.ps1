# Construit le module WebAssembly du noyau Rust, chargeable par un navigateur.
#
# Ce n'est pas un exemple de test : c'est l'artefact livrable. Il sort du crate
# `pdfyz-wasm`, le seul declare en `cdylib`, et il est copie sous un nom stable :
#
#     dist/pdfyz_core.wasm
#
# Le module n'a AUCUN import : il se charge avec
# `WebAssembly.instantiate(bytes, {})`, sans WASI ni fonction hote. C'est ce que
# verifie `scripts/validate-wasm.mjs`.
#
# Il est aussi copie, avec la colle `web/pdfyz-core.js`, dans
# `../pdfyz-astro/public/` quand ce dossier existe : l'application Astro sert ces
# deux fichiers tels quels (pas d'etape de compilation cote Rust pour le web).
#
# Usage : pwsh -File scripts/build-wasm.ps1 [--debug]
# Retour : 0 si tout passe, 1 sinon.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$env:Path = "$(Join-Path $HOME '.cargo\bin');$env:Path"
$cargo = Join-Path $HOME '.cargo\bin\cargo.exe'

if (-not (Test-Path $cargo)) {
  throw "cargo introuvable : $cargo (installe Rust : winget install Rustlang.Rustup)"
}

Push-Location $root

try {
  $profile = if ($args -contains '--debug') { 'debug' } else { 'release' }
  $arguments = @('build', '-p', 'pdfyz-wasm', '--target', 'wasm32-unknown-unknown')
  if ($profile -eq 'release') { $arguments += '--release' }

  Write-Host "-- cargo build ($profile, wasm32-unknown-unknown)" -ForegroundColor Cyan
  & $cargo @arguments
  if ($LASTEXITCODE -ne 0) { throw 'compilation du module wasm impossible' }

  $built = Join-Path $root "target\wasm32-unknown-unknown\$profile\pdfyz_wasm.wasm"
  if (-not (Test-Path $built)) { throw "module introuvable : $built" }

  $dist = Join-Path $root 'dist'
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  $final = Join-Path $dist 'pdfyz_core.wasm'
  Copy-Item $built $final -Force
  $octets = (Get-Item $final).Length
  $ko = [math]::Round($octets / 1KB, 1)
  Write-Host "OK : $final ($ko Ko)" -ForegroundColor Green

  # Copie vers l'application Astro, si elle est presente. Le module y est servi
  # depuis `public/` : meme URL qu'en production, donc ce que l'on valide en local
  # est exactement ce qui part en ligne.
  $webDir = Join-Path $root '..\pdfyz-astro\public'
  if (Test-Path $webDir) {
    Copy-Item $final (Join-Path $webDir 'pdfyz_core.wasm') -Force
    Copy-Item (Join-Path $root 'web\pdfyz-core.js') (Join-Path $webDir 'pdfyz-core.js') -Force
    Write-Host "OK : copie dans pdfyz-astro/public/ (wasm + colle)" -ForegroundColor Green
  } else {
    Write-Host "-- pdfyz-astro/public absent : copie web ignoree" -ForegroundColor Yellow
  }

  Write-Host "-- node scripts/validate-wasm.mjs" -ForegroundColor Cyan
  node (Join-Path $root 'scripts\validate-wasm.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'validation du module wasm en echec' }
}
finally {
  Pop-Location
}
