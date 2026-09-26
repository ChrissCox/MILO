# Creates (or refreshes) a MILO shortcut in this folder and on the desktop.
# The shortcut runs "Launch MILO.vbs" through wscript, so no console window opens.
$ErrorActionPreference = 'Stop'
$miloRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$miloIcon = Join-Path $miloRoot 'assets\milo.ico'
$launcher = Join-Path $miloRoot 'Launch MILO.vbs'

if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Launch MILO.vbs was not found in $miloRoot"
}

# assets\milo.ico ships with the project. Only draw a simple pixel stand-in if it's missing.
if (-not (Test-Path -LiteralPath $miloIcon)) {
  Add-Type -AssemblyName System.Drawing
  New-Item -ItemType Directory -Force (Split-Path $miloIcon) | Out-Null
  $bitmap = New-Object System.Drawing.Bitmap 64, 64
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#b5d69c'))
  $ink = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#3d4038'))
  $cream = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#fbf7e9'))
  $graphics.FillRectangle($ink, 12, 12, 40, 40)
  $graphics.FillRectangle($cream, 16, 16, 32, 32)
  $graphics.FillRectangle($ink, 24, 28, 4, 6)
  $graphics.FillRectangle($ink, 36, 28, 4, 6)
  $icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
  $stream = [IO.File]::Create($miloIcon)
  $icon.Save($stream)
  $stream.Dispose()
  $icon.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  $ink.Dispose()
  $cream.Dispose()
}

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path $miloRoot 'MILO.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'MILO.lnk')
)
foreach ($target in $targets) {
  $existed = Test-Path -LiteralPath $target
  $shortcut = $shell.CreateShortcut($target)
  $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $shortcut.Arguments = '"' + $launcher + '"'
  $shortcut.WorkingDirectory = $miloRoot
  $shortcut.Description = 'MILO: Milo keeps watch over your AI crew'
  $shortcut.IconLocation = $miloIcon
  $shortcut.Save()
  if ($existed) { Write-Output "Refreshed $target" } else { Write-Output "Created $target" }
}
