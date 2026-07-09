# Собирает ghostfire_yandex.zip для загрузки в консоль Яндекс Игр.
# Запуск: powershell -File tools/pack_yandex.ps1
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root "ghostfire_yandex.zip"
Remove-Item $out -ErrorAction SilentlyContinue
$items = @('index.html', 'editor.html', 'js', 'maps', 'skins', 'ghosts') |
  ForEach-Object { Join-Path $root $_ }
Compress-Archive -Path $items -DestinationPath $out
Write-Host "Готово: $out ($([math]::Round((Get-Item $out).Length / 1KB)) КБ)"
