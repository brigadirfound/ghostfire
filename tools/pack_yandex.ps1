param(
  [string]$OutputPath = "ghostfire_yandex.zip",
  [switch]$AllowDirty
)

$projectRoot = Split-Path $PSScriptRoot -Parent
$arguments = @((Join-Path $PSScriptRoot "pack_release.mjs"), "--output=$OutputPath")
if ($AllowDirty) { $arguments += "--allow-dirty" }

Push-Location $projectRoot
try {
  & node @arguments
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
