#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$outputRoot = Join-Path $projectRoot 'output/installer'
$buildRoot = Join-Path $outputRoot ('build-check-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $buildRoot -Force)
Import-Module (Join-Path (Split-Path $PSScriptRoot) 'Installer.Core.psm1') -Force
try {
    foreach ($directory in @('src', 'public')) { Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination $buildRoot -Recurse }
    Get-ChildItem -LiteralPath $projectRoot -File -Filter 'tsconfig*.json' | Copy-Item -Destination $buildRoot
    foreach ($file in @('package.json', 'package-lock.json')) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $buildRoot }
    $files = New-InstallerFiles 'personal-memo' 'はなこのことばメモ' 'main' ([IO.File]::ReadAllText((Join-Path $projectRoot 'index.html'))) ([IO.File]::ReadAllText((Join-Path $projectRoot 'src/App.tsx'))) 'https://abcdefghijklmnopqrst.supabase.co' 'sb_publishable_testPublicKey1234567890'
    foreach ($file in $files.Keys) {
        $target = Join-Path $buildRoot $file
        [void](New-Item -ItemType Directory -Path (Split-Path $target) -Force)
        [IO.File]::WriteAllText($target, $files[$file], (New-Object Text.UTF8Encoding($false)))
    }
    Push-Location $buildRoot
    try {
        & node.exe (Join-Path $projectRoot 'node_modules/typescript/bin/tsc') -b
        if ($LASTEXITCODE -ne 0) { throw 'Generated TypeScript build failed.' }
        & node.exe (Join-Path $projectRoot 'node_modules/vite/bin/vite.js') build
        if ($LASTEXITCODE -ne 0) { throw 'Generated PWA build failed.' }
        $manifest = Get-Content -LiteralPath 'dist/manifest.webmanifest' -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.name -cne 'はなこのことばメモ' -or $manifest.start_url -cne '/personal-memo/') { throw 'Generated manifest does not match the inputs.' }
        if (-not (Test-Path -LiteralPath 'dist/install.html')) { throw 'PC installation page missing.' }
        if (-not (Test-Path -LiteralPath 'dist/mobile-install.html')) { throw 'Mobile installation page missing.' }
        $mobileConfig = Get-Content -LiteralPath 'dist/installer-config.json' -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($mobileConfig.storageMode -cne 'supabase' -or $mobileConfig.schemaVersion -ne 2 -or $mobileConfig.repository -cne 'personal-memo' -or $mobileConfig.appName -cne $manifest.name) { throw 'Mobile installer configuration does not match the generated app.' }
        $syntaxCheckPath = Join-Path $buildRoot 'mobile-syntax-check.cjs'
        [IO.File]::WriteAllText($syntaxCheckPath, 'const fs=require("fs"),vm=require("vm");new vm.Script(fs.readFileSync("dist/mobile-install.html","utf8").match(/<script>([\s\S]*?)<\/script>/)[1]);')
        & node.exe $syntaxCheckPath
        if ($LASTEXITCODE -ne 0) { throw 'Mobile installer JavaScript cannot be parsed.' }
        $serviceWorker = Get-Content -LiteralPath 'dist/sw.js' -Raw -Encoding UTF8
        if (-not $serviceWorker.Contains('install.html')) { throw 'PC installation page is not precached.' }
        if (-not $serviceWorker.Contains('mobile-install.html')) { throw 'Mobile installation page is not precached.' }
        Write-Output 'Generated TypeScript build, PWA build, manifest, PC and mobile pages, mobile configuration and precache verified.'
    } finally { Pop-Location }
} finally {
    Remove-Module Installer.Core -ErrorAction SilentlyContinue
    $resolvedBuildRoot = [IO.Path]::GetFullPath($buildRoot)
    $resolvedOutputRoot = [IO.Path]::GetFullPath($outputRoot)
    if ($resolvedBuildRoot.StartsWith($resolvedOutputRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedBuildRoot -Leaf) -like 'build-check-*') {
        Remove-Item -LiteralPath $resolvedBuildRoot -Recurse -Force
    }
}
