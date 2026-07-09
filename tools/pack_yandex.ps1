# Builds ghostfire_yandex.zip for the Yandex Games developer console.
# Run: powershell -File tools/pack_yandex.ps1
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root "ghostfire_yandex.zip"
Remove-Item $out -ErrorAction SilentlyContinue
$items = @('index.html', 'editor.html', 'js', 'maps', 'skins', 'ghosts') |
  ForEach-Object { Join-Path $root $_ }
Compress-Archive -Path $items -DestinationPath $out
Write-Host "Done: $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"
