#requires -Version 5.1
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'output/installer' }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
[void](New-Item -ItemType Directory -Path $outputRoot -Force)
$stagePath = Join-Path $outputRoot ('package-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $stagePath)
try {
    foreach ($file in @('Start-Installer.cmd', 'KotobaMemoInstaller.ps1', 'Installer.Core.psm1', 'Setup.html')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $stagePath $file)
    }
    $mobileStage = Join-Path $stagePath 'mobile'
    [void](New-Item -ItemType Directory -Path $mobileStage)
    foreach ($file in @('mobile-install.html', 'installer-config.json', 'README.md')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('../mobile/' + $file)) -Destination $mobileStage
    }
    $templateStage = Join-Path $stagePath 'app-template'
    [void](New-Item -ItemType Directory -Path (Join-Path $templateStage 'src') -Force)
    [void](New-Item -ItemType Directory -Path (Join-Path $templateStage 'supabase') -Force)
    foreach ($file in @('App.tsx','storage.ts','categories.ts','supabase.ts','cloud-sync.ts')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot ('src/' + $file)) -Destination (Join-Path $templateStage 'src')
    }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'supabase/installer-schema.sql') -Destination (Join-Path $templateStage 'supabase')
    $readme = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'README.md')).Replace('../../doc/installation_guide.md', 'installation_guide.md').Replace('../mobile/README.md', 'mobile/README.md')
    $guide = [IO.File]::ReadAllText((Join-Path $projectRoot 'doc/installation_guide.md')).Replace('../installer/pc/README.md', 'README.md').Replace('../installer/mobile/README.md', 'mobile/README.md').Replace('kotoba-memo-pc-installer/README.md', 'README.md').Replace('kotoba-memo-pc-installer/mobile/README.md', 'mobile/README.md')
    # Source-code links point to GitHub in the standalone ZIP.
    $guide = [regex]::Replace($guide, '\]\(\.\./([^)]+)\)', '](' + 'https://github.com/kazunyon/situgosyou/blob/main/$1' + ')')
    [IO.File]::WriteAllText((Join-Path $stagePath 'README.md'), $readme, (New-Object Text.UTF8Encoding($true)))
    [IO.File]::WriteAllText((Join-Path $stagePath 'installation_guide.md'), $guide, (New-Object Text.UTF8Encoding($true)))
    Copy-Item -LiteralPath (Join-Path $projectRoot 'doc/installation_support_notes.md') -Destination $stagePath
    $zipPath = Join-Path $outputRoot 'kotoba-memo-pc-installer.zip'
    Compress-Archive -Path (Join-Path $stagePath '*') -DestinationPath $zipPath -Force
    Write-Output $zipPath
    Write-Output ('SHA256: ' + (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash)
} finally {
    $resolvedStage = [IO.Path]::GetFullPath($stagePath)
    if ($resolvedStage.StartsWith($outputRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedStage -Leaf) -like 'package-*') {
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}
