# Verification complete du noyau Rust de PDF-YZ.
#
# Enchaine : formatage, types, lint, tests, build WebAssembly, puis la parite
# avec l'implementation JavaScript de reference.
#
# Les tests tournent en WebAssembly (`wasm32-wasip1`, lances par Node) : le
# linker natif MSVC n'est pas installe sur la machine de developpement. C'est
# aussi un avantage — on teste exactement la cible deployee.
#
# Usage : pwsh -File scripts/check.ps1
# Retour : 0 si tout passe, 1 sinon.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$env:Path = "$(Join-Path $HOME '.cargo\bin');$env:Path"
$cargo = Join-Path $HOME '.cargo\bin\cargo.exe'
$node = 'node'

if (-not (Test-Path $cargo)) {
  throw "cargo introuvable : $cargo (installe Rust : winget install Rustlang.Rustup)"
}

Push-Location $root
$ok = $true
$echecs = [System.Collections.Generic.List[string]]::new()

function Step($label, $script) {
  Write-Host "-- $label" -ForegroundColor Cyan
  & $script
  if ($LASTEXITCODE -ne 0) {
    Write-Host "   x echec ($LASTEXITCODE) : $label" -ForegroundColor Red
    $script:echecs.Add("$label (code $LASTEXITCODE)")
    $script:ok = $false
  }
}

Step 'cargo fmt --check'                    { & $cargo fmt --check }
Step 'cargo check --all-targets'            { & $cargo check --workspace --all-targets }
Step 'cargo clippy -- -D warnings'          { & $cargo clippy --workspace --all-targets -- -D warnings }
Step 'cargo test (wasm32-wasip1)'           { & $cargo test --workspace --target wasm32-wasip1 }
# Le module LIVRABLE : construit, charge sans aucun import, puis compare
# fonction par fonction a l'implementation JavaScript de reference. C'est
# l'etape qui distingue « bibliotheque Rust » de « noyau utilisable par le site ».
Step 'module wasm + parite JavaScript'      { pwsh -File (Join-Path $PSScriptRoot 'build-wasm.ps1') | Out-Null }

if ($ok) {
  Write-Host ''
  Write-Host 'OK : noyau Rust verifie' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host ("x {0} etape(s) en echec :" -f $echecs.Count) -ForegroundColor Red
  foreach ($e in $echecs) { Write-Host "   - $e" -ForegroundColor Red }
}

Pop-Location
exit $(if ($ok) { 0 } else { 1 })
