#requires -Version 5.1
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '../../output/installer' }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
[void](New-Item -ItemType Directory -Path $outputRoot -Force)
$files = @('mobile-install.html', 'installer-config.json', 'README.md') | ForEach-Object { Join-Path $PSScriptRoot $_ }
$zipPath = Join-Path $outputRoot 'kotoba-memo-mobile-installer.zip'
Compress-Archive -LiteralPath $files -DestinationPath $zipPath -Force
Write-Output $zipPath
