#requires -Version 5.1

function Send-InstallerEvent {
    param($Context, [string]$Kind, [string]$Message, $Value)
    $Context.Queue.Enqueue([pscustomobject]@{ Kind = $Kind; Message = $Message; Value = $Value })
}

function Assert-NotCancelled {
    param($Context)
    if ($Context.Cancellation.IsCancellationRequested) { throw '操作を中止しました。作成済みの公開先は削除されません。' }
}

function Wait-InstallerStep {
    param($Context, [int]$Seconds)
    for ($i = 0; $i -lt $Seconds * 10; $i++) {
        Assert-NotCancelled $Context
        Start-Sleep -Milliseconds 100
    }
}

function Assert-InstallerSettings {
    param([string]$Owner, [string]$Repository, [string]$AppName)
    if ($Owner -notmatch '^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$') {
        throw 'GitHubユーザー名を確認してください。メールアドレスではなく、GitHubのユーザー名を入力します。'
    }
    if ($Repository -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$' -or $Repository -match '\.github\.io$') {
        throw '公開用リポジトリ名は半角英数字で始め、英数字・ハイフン・アンダースコア・ピリオドの64文字以内にしてください。.github.ioで終わる名前は使えません。'
    }
    if ([string]::IsNullOrWhiteSpace($AppName) -or $AppName.Length -gt 40 -or $AppName -match '[\x00-\x1f]') {
        throw 'アプリの表示名を1～40文字で入力してください。改行は使えません。'
    }
    if ($Owner -ieq 'kazunyon' -and $Repository -ieq 'situgosyou') {
        throw '作者の元リポジトリはインストール先にできません。別の公開用リポジトリ名を入力してください。'
    }
}

function ConvertTo-WindowsArgument {
    param([AllowEmptyString()][string]$Value)
    # ProcessStartInfo.Arguments uses the Windows argv quoting rules; never a shell.
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function ConvertTo-InstallerSupabaseUrl {
    param([string]$Url)
    $value = $Url.Trim().TrimEnd('/')
    if ($value -match '^https://supabase\.com/dashboard/project/([a-z0-9]{20})(?:[/?#].*)?$') { return 'https://' + $Matches[1].ToLowerInvariant() + '.supabase.co' }
    if ($value -match '^https://([a-z0-9]{20})\.supabase\.co$') { return 'https://' + $Matches[1].ToLowerInvariant() + '.supabase.co' }
    throw 'Supabaseの入力欄に、自分のProject URLまたは管理画面のURLを貼り付けてください。「公開先URL」は別の欄です。'
}

function Assert-InstallerSupabase {
    param([string]$Url, [string]$Key)
    if ($Url -cnotmatch '^https://[a-z0-9]{20}\.supabase\.co/?$') { throw '自分のSupabase Project URLを https://プロジェクトID.supabase.co の形で入力してください。' }
    if ($Key -cmatch '^sb_publishable_[a-zA-Z0-9_-]{10,}$') { return }
    if ($Key -match '^sb_secret_' -or $Key -notmatch '^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$') { throw 'Publishable keyまたは旧anonキーを入力してください。secret・service_role・管理用トークンは使えません。' }
    try {
        $payload = ($Key -split '\.')[1].Replace('-', '+').Replace('_', '/')
        $payload = $payload.PadRight($payload.Length + ((4 - $payload.Length % 4) % 4), '=')
        $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
        $reference = ([uri]$Url).Host.Split('.')[0]
        if ($claims.role -cne 'anon' -or $claims.ref -cne $reference) { throw 'not-anon' }
    } catch { throw '旧キーの場合は、このProject URLと一致するanonキーだけを使えます。service_roleは使えません。' }
}

function Get-InstallerTemplateRoot {
    $template = Join-Path $PSScriptRoot 'app-template'
    if (Test-Path -LiteralPath (Join-Path $template 'src/App.tsx')) { return $template }
    return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
}

function Get-InstallerSetupSql {
    return [IO.File]::ReadAllText((Join-Path (Get-InstallerTemplateRoot) 'supabase/installer-schema.sql'))
}

function Test-InstallerSupabase {
    param([string]$Url, [string]$Key)
    Assert-InstallerSupabase $Url $Key
    try {
        $result = Invoke-RestMethod -Uri ($Url.TrimEnd('/') + '/rest/v1/rpc/kotoba_installer_status') -Method POST -Headers @{ apikey = $Key } -ContentType 'application/json' -Body '{}' -TimeoutSec 20
        if ($result.schemaVersion -ne 2 -or $result.rls -ne $true -or $result.realtime -ne $true -or $result.ownerPolicies -ne $true) { throw 'setup-incomplete' }
    } catch { throw 'Supabaseの初期設定を確認できません。自分のProject URL・公開キーを確認し、同梱の初期設定SQLを自分のSQL Editorで実行してください。' }
}

function Get-InstallerConnectionFingerprint {
    param([string]$Url,[string]$Key)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Url.TrimEnd('/') + "`n" + $Key))).Replace('-', '') }
    finally { $hash.Dispose() }
}

function Invoke-GhCommand {
    param($Context, [string[]]$Arguments, [string]$InputText = '', [int]$TimeoutSeconds = 120, [switch]$Authentication)
    Assert-NotCancelled $Context
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $Context.GhPath
    $start.Arguments = (($Arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $start.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    $start.EnvironmentVariables['GH_CONFIG_DIR'] = (Join-Path $Context.DataRoot 'github-config')
    $start.EnvironmentVariables['GH_HOST'] = 'github.com'
    # gh sends API JSON through stdin. HTTP/2 stream resets cannot replay that body.
    # Use HTTPS over HTTP/1.1 for this child process; certificate checks stay enabled.
    $goDebug = $start.EnvironmentVariables['GODEBUG']
    $goDebugOptions = @($goDebug -split ',' | Where-Object { $_ -and $_ -notmatch '^http2client=' })
    $start.EnvironmentVariables['GODEBUG'] = (@($goDebugOptions) + 'http2client=0') -join ','
    $start.EnvironmentVariables.Remove('GH_TOKEN')
    $start.EnvironmentVariables.Remove('GITHUB_TOKEN')
    $start.EnvironmentVariables.Remove('GH_DEBUG')
    $start.EnvironmentVariables.Remove('GH_PROMPT_DISABLED')
    $start.EnvironmentVariables.Remove('GH_BROWSER')
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    $started = $false
    try {
        if (-not $process.Start()) { throw 'GitHub CLIを起動できませんでした。' }
        $started = $true
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        if ($Authentication) {
            $stderr = New-Object System.Text.StringBuilder
            $lineTask = $process.StandardError.ReadLineAsync()
            # gh's web flow waits for Enter before opening the browser.
            $process.StandardInput.WriteLine()
            $process.StandardInput.Close()
        } else {
            $stderrTask = $process.StandardError.ReadToEndAsync()
            # .NET Framework used by Windows PowerShell has no StandardInputEncoding.
            $inputBytes = [Text.Encoding]::UTF8.GetBytes($InputText)
            $inputStream = $process.StandardInput.BaseStream
            $inputStream.Write($inputBytes, 0, $inputBytes.Length)
            $inputStream.Flush()
            $inputStream.Close()
        }
        $watch = [Diagnostics.Stopwatch]::StartNew()
        while (-not $process.HasExited) {
            Assert-NotCancelled $Context
            if ($watch.Elapsed.TotalSeconds -gt $TimeoutSeconds) { throw '処理が時間内に終わりませんでした。通信とGitHubの状態を確認して再試行してください。' }
            if ($Authentication -and $lineTask -and $lineTask.IsCompleted) {
                $line = $lineTask.GetAwaiter().GetResult()
                if ($null -ne $line) {
                    [void]$stderr.AppendLine($line)
                    if ($line -match '(?<![A-Z0-9])([A-Z0-9]{4}-[A-Z0-9]{4})(?![A-Z0-9])') {
                        Send-InstallerEvent $Context 'code' 'ブラウザで確認コードを入力し、GitHub CLIを許可してください。' $Matches[1]
                    }
                    $lineTask = $process.StandardError.ReadLineAsync()
                } else { $lineTask = $null }
            }
            Start-Sleep -Milliseconds 100
        }
        if ($Authentication) {
            # Drain output that arrived immediately before process exit.
            if ($lineTask) {
                $line = $lineTask.GetAwaiter().GetResult()
                if ($null -ne $line) { [void]$stderr.AppendLine($line) }
            }
            [void]$stderr.Append($process.StandardError.ReadToEnd())
            $errorText = $stderr.ToString()
        } else { $errorText = $stderrTask.GetAwaiter().GetResult() }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $stdoutTask.GetAwaiter().GetResult(); Error = $errorText }
    } finally {
        if ($started -and -not $process.HasExited) { $process.Kill() }
        $process.Dispose()
    }
}

function Invoke-InstallerApi {
    param($Context, [string]$Endpoint, [string]$Method = 'GET', $Body = $null, [switch]$AllowNotFound)
    $arguments = @('api', '--hostname', 'github.com', '--method', $Method, $Endpoint,
        '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28')
    $inputText = ''
    if ($null -ne $Body) { $arguments += @('--input', '-'); $inputText = ConvertTo-Json -InputObject $Body -Depth 100 -Compress }
    $result = Invoke-GhCommand $Context $arguments $inputText
    if ($result.ExitCode -ne 0) {
        if ($AllowNotFound -and $result.Error -match 'HTTP 404') { return $null }
        $status = if ($result.Error -match 'HTTP (\d{3})') { $Matches[1] } else { '不明' }
        throw "GitHubの操作に失敗しました（HTTP $status、$Method $Endpoint）。権限・通信・Actionsの実行結果を確認してください。GitHubからの説明：$($result.Error.Trim())"
    }
    if ([string]::IsNullOrWhiteSpace($result.Output)) { return $null }
    return ConvertFrom-Json -InputObject $result.Output
}

function Get-InstallerGh {
    param($Context)
    $toolsDirectory = Join-Path $Context.DataRoot 'tools'
    $cached = Join-Path $toolsDirectory 'gh\bin\gh.exe'
    if (Test-Path -LiteralPath $cached) { return $cached }
    $installed = Get-Command gh.exe -ErrorAction SilentlyContinue
    if ($installed) {
        # Older versions may not support --clipboard; a current portable copy is used instead.
        $help = & $installed.Source auth login --help 2>&1 | Out-String
        if ($help -match '--clipboard') { return $installed.Source }
    }
    Send-InstallerEvent $Context 'progress' 'GitHub公式のログイン用ツールをダウンロードしています。' $null
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $headers = @{ 'User-Agent' = 'KotobaMemo-PC-Installer'; Accept = 'application/vnd.github+json' }
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/cli/cli/releases/latest' -Headers $headers -TimeoutSec 60
    $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }
    $asset = @($release.assets | Where-Object { $_.name -match "^gh_[0-9.]+_windows_$architecture\.zip$" })
    $checksums = @($release.assets | Where-Object { $_.name -match '^gh_[0-9.]+_checksums\.txt$' })
    if ($asset.Count -ne 1 -or $checksums.Count -ne 1) { throw 'GitHub CLIのWindows用ファイルが見つかりませんでした。GitHub CLIの公式ページで対応状況を確認してください。' }
    foreach ($item in @($asset[0], $checksums[0])) {
        if ($item.browser_download_url -notmatch '^https://github\.com/cli/cli/releases/download/') { throw 'ダウンロード先がGitHub CLIの公式リリースではありません。' }
    }
    [void](New-Item -ItemType Directory -Path $toolsDirectory -Force)
    $zipPath = Join-Path $toolsDirectory $asset[0].name
    Assert-NotCancelled $Context
    Invoke-WebRequest -UseBasicParsing -Uri $asset[0].browser_download_url -OutFile $zipPath -TimeoutSec 180
    $checksumText = (Invoke-WebRequest -UseBasicParsing -Uri $checksums[0].browser_download_url -TimeoutSec 60).Content
    $pattern = '(?m)^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($asset[0].name) + '\s*$'
    if ($checksumText -notmatch $pattern) { throw 'GitHub CLIのチェックサムが見つかりませんでした。' }
    if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ine $Matches[1]) { throw 'ダウンロードファイルの検証に失敗しました。展開・実行を中止しました。' }
    Assert-NotCancelled $Context
    $unpack = Join-Path $toolsDirectory ('unpack-' + [guid]::NewGuid().ToString('N'))
    Expand-Archive -LiteralPath $zipPath -DestinationPath $unpack
    $executables = @(Get-ChildItem -LiteralPath $unpack -Filter gh.exe -File -Recurse)
    if ($executables.Count -ne 1) { throw 'GitHub CLIの実行ファイルを確認できませんでした。' }
    [void](New-Item -ItemType Directory -Path (Split-Path $cached) -Force)
    Copy-Item -LiteralPath $executables[0].FullName -Destination $cached -Force
    return $cached
}

function Connect-InstallerGitHub {
    param($Context)
    $Context.GhPath = Get-InstallerGh $Context
    $user = $null
    try { $user = Invoke-InstallerApi $Context 'user' } catch { }
    if (-not $user) {
        Send-InstallerEvent $Context 'progress' 'GitHubへのログイン画面を開きます。確認コードを貼り付け、許可してください。' $null
        $login = Invoke-GhCommand $Context @('auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--clipboard', '--scopes', 'workflow') -Authentication -TimeoutSeconds 900
        if ($login.ExitCode -ne 0) { throw 'GitHubへのログインが完了しませんでした。もう一度ログインボタンを押してください。' }
        $user = Invoke-InstallerApi $Context 'user'
    }
    if ($user.type -ne 'User') { throw '個人のGitHubアカウントでログインしてください。組織アカウントはこのツールの対象外です。' }
    Send-InstallerEvent $Context 'login' "GitHubの $($user.login) さんとしてログインできました。" $user.login
}

function New-InstallerFiles {
    param([string]$Repository, [string]$AppName, [string]$Branch, [string]$IndexSource, [string]$AppSource, [string]$SupabaseUrl, [string]$SupabaseKey)
    $nameJson = ConvertTo-Json -InputObject $AppName -Compress
    $branchJson = ConvertTo-Json -InputObject $Branch -Compress
    $nameHtml = [System.Security.SecurityElement]::Escape($AppName)
    if ($IndexSource -notmatch '<title>[^<]*</title>' -or $AppSource -notmatch '<h1>ことばメモ</h1>') {
        throw '元のアプリの画面構成が変わっています。このツールを更新してから実行してください。'
    }
    $vite = @'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/@@REPOSITORY@@/' : '/',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      id: '/@@REPOSITORY@@/', start_url: '/@@REPOSITORY@@/', scope: '/@@REPOSITORY@@/',
      name: @@NAME@@, short_name: @@NAME@@,
      description: '端末内に保存する個人用のことばメモ',
      theme_color: '#ffffff', background_color: '#ffffff', display: 'standalone', lang: 'ja',
      icons: [
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
      ]
    }
  })]
}))
'@
    $workflow = @'
name: Deploy to GitHub Pages
on:
  push:
    branches: [@@BRANCH@@]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: Build without Supabase
        run: npm ci && npm run build
        env:
          VITE_SUPABASE_URL: ''
          VITE_SUPABASE_ANON_KEY: ''
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
'@
    $install = @'
<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#ffffff">
<link rel="manifest" href="./manifest.webmanifest"><link rel="icon" href="./pwa-192x192.png">
<title>@@NAME@@をインストール</title>
<style>body{margin:0;background:#f3f6fb;color:#183047;font:18px/1.7 system-ui,sans-serif}main{max-width:650px;margin:40px auto;padding:32px;background:white;border-radius:20px}h1{font-size:28px}button,a.action{display:block;box-sizing:border-box;width:100%;padding:18px;margin:18px 0;border:0;border-radius:12px;background:#165bcc;color:white;font:inherit;text-align:center;text-decoration:none;cursor:pointer}button:disabled{background:#8796aa;cursor:default}.note{background:#eef4ff;padding:16px;border-radius:12px}:focus-visible{outline:4px solid #ffb020;outline-offset:4px}@media(max-width:700px){main{margin:16px;padding:24px}}</style></head>
<body><main><h1 id="appname">@@NAME@@</h1><p>PCにインストールすると、スタートから開けます。メモはこの端末に保存されます。Supabaseは使いません。</p>
<button id="install" disabled>インストールを準備しています…</button><p id="status" role="status" aria-live="polite">EdgeまたはChromeで開いてください。インストールの確認画面では「インストール」を押します。</p>
<div class="note"><strong>ボタンが使えないとき</strong><p>アドレスバー右側のインストールアイコン、またはブラウザのメニューからインストールしてください。すでに入っている場合は、スタートから開けます。</p></div>
<a class="action" href="./">アプリを開く</a><p>最初に「設定」からカテゴリを1件追加してください。PCとスマートフォンのデータは自動同期されません。</p></main>
<script>
let deferred; const button=document.getElementById('install'),status=document.getElementById('status');
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;button.disabled=false;button.textContent='このPCにインストール';});
button.addEventListener('click',async()=>{if(!deferred)return;button.disabled=true;try{await deferred.prompt();const result=await deferred.userChoice;status.textContent=result.outcome==='accepted'?'インストールを受け付けました。スタートのアプリ一覧から起動を確認してください。':'キャンセルしました。ブラウザのインストールアイコンから再度進められます。';}catch{status.textContent='ブラウザのインストールアイコンから進めてください。';}deferred=null;button.textContent='ブラウザの確認結果をご覧ください';});
window.addEventListener('appinstalled',()=>{button.textContent='インストール済み';button.disabled=true;status.textContent='インストールが完了しました。スタートから起動し、保存結果を確認してください。';});
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{status.textContent='準備ができませんでした。オンラインで再読み込みしてください。';});
</script></body></html>
'@
    $index = [regex]::Replace($IndexSource, '<title>[^<]*</title>', [System.Text.RegularExpressions.MatchEvaluator]{ param($match) '<title>' + $nameHtml + '</title>' })
    $mobileDirectory = Join-Path $PSScriptRoot 'mobile'
    if (-not (Test-Path -LiteralPath (Join-Path $mobileDirectory 'mobile-install.html'))) {
        $mobileDirectory = Join-Path $PSScriptRoot '../mobile'
    }
    $mobilePage = [IO.File]::ReadAllText((Join-Path $mobileDirectory 'mobile-install.html'))
    $mobileConfig = ConvertTo-Json -InputObject @{ schemaVersion = 1; storageMode = 'device'; repository = $Repository; appName = $AppName } -Compress
    $install = $install.Replace('</main>', '<a class="action" href="./mobile-install.html">スマホ用インストールツールを開く</a></main>')
    $index = $index.Replace('</head>', ('<link rel="apple-touch-icon" href="./pwa-192x192.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="' + $nameHtml + '"></head>'))
    $generated = @{
        'vite.config.ts' = $vite.Replace('@@REPOSITORY@@', $Repository).Replace('@@NAME@@', $nameJson)
        '.github/workflows/deploy-pages.yml' = $workflow.Replace('@@BRANCH@@', $branchJson)
        'index.html' = $index
        'src/App.tsx' = $AppSource.Replace('<h1>ことばメモ</h1>', ('<h1>{' + $nameJson + '}</h1>'))
        'public/install.html' = $install.Replace('@@NAME@@', $nameHtml)
        'public/mobile-install.html' = $mobilePage
        'public/installer-config.json' = $mobileConfig
    }
    if ($SupabaseUrl -or $SupabaseKey) {
        $SupabaseUrl = ConvertTo-InstallerSupabaseUrl $SupabaseUrl
        Assert-InstallerSupabase $SupabaseUrl $SupabaseKey
        $SupabaseUrl = $SupabaseUrl.TrimEnd('/')
        $templateRoot = Get-InstallerTemplateRoot
        foreach ($path in @('src/App.tsx','src/storage.ts','src/categories.ts','src/supabase.ts','src/cloud-sync.ts')) {
            $generated[$path] = [IO.File]::ReadAllText((Join-Path $templateRoot $path))
        }
        $generated['src/App.tsx'] = $generated['src/App.tsx'].Replace('<h1>ことばメモ</h1>', ('<h1>{' + $nameJson + '}</h1>'))
        $connectionJson = ConvertTo-Json -InputObject @{url=$SupabaseUrl;publishableKey=$SupabaseKey} -Compress
        $generated['src/installer-connection.ts'] = 'export const installerConnection: { url: string; publishableKey: string } | null = ' + $connectionJson
        $generated['vite.config.ts'] = $generated['vite.config.ts'].Replace('端末内に保存する個人用のことばメモ', '自分のSupabaseでPCとスマホを同期することばメモ')
        $generated['.github/workflows/deploy-pages.yml'] = $generated['.github/workflows/deploy-pages.yml'].Replace('Build without Supabase', 'Build with supplied Supabase configuration')
        $generated['public/installer-config.json'] = ConvertTo-Json -InputObject @{schemaVersion=2;storageMode='supabase';repository=$Repository;appName=$AppName;supabaseUrl=$SupabaseUrl} -Compress
        $generated['public/supabase-setup.sql'] = Get-InstallerSetupSql
        $generated['supabase/installer-schema.sql'] = Get-InstallerSetupSql
        $generated['public/setup.html'] = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Setup.html'))
        $generated['public/install.html'] = $generated['public/install.html'].Replace('メモはこの端末に保存されます。Supabaseは使いません。', 'メモは導入者自身のSupabaseに保存し、PCとスマホで同期します。').Replace('PCとスマートフォンのデータは自動同期されません。', 'PCとスマートフォンで同じメールアドレスの確認コードを使ってログインしてください。').Replace('最初に「設定」からカテゴリを1件追加してください。', 'インストール後にメールの確認コードでログインし、「設定」からカテゴリを1件追加してください。')
        $appLink = '<a class="action" href="./">アプリを開く</a>'
        $generated['public/install.html'] = $generated['public/install.html'].Replace($appLink, '').Replace('<button id="install"', ('<p>ブラウザだけで使えます。PWA追加は希望する場合に行います。</p>' + $appLink + '<button id="install"')).Replace('インストール後にメールの確認コードでログインし、', 'アプリを開いてメールの確認コードでログインし、')
    }
    return $generated
}

function Write-InstallerState {
    param([string]$Path, $State)
    [void](New-Item -ItemType Directory -Path (Split-Path $Path) -Force)
    $temporaryPath = $Path + '.tmp'
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporaryPath, (ConvertTo-Json -InputObject $State -Depth 20), $utf8)
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Assert-InstallerRepository {
    param($RepositoryInfo, $State, [string]$ExpectedFullName)
    if ($RepositoryInfo.full_name -ine $ExpectedFullName) {
        throw 'コピー先が指定した新規リポジトリと一致しません。既存の別リポジトリは変更しません。GitHubのコピー先を確認してください。'
    }
    if (-not $State -or ($State.RepositoryId -and $State.RepositoryId -ne $RepositoryInfo.id)) {
        throw '同名のリポジトリがすでにあります。上書きせずに停止しました。別の公開用リポジトリ名を入力してください。'
    }
    if (-not $State.RepositoryId) {
        $descriptionPrefix = if ($State.ConnectionFingerprint) { 'Supabase sync Kotoba Memo PWA (installer:' } else { 'Local-only Kotoba Memo PWA (installer:' }
        if ($State.Stage -ne 'creating' -or -not $State.CreationTag -or
            $RepositoryInfo.description -cne ($descriptionPrefix + $State.CreationTag + ')') -or
            [datetime]$RepositoryInfo.created_at -lt ([datetime]$State.StartedAt).AddSeconds(-10)) {
            throw '以前からあるリポジトリは変更できません。別の公開用リポジトリ名を入力してください。'
        }
    }
}

function Get-InstallerArchiveFiles {
    param($Context, [string]$SourceSha)
    if ($SourceSha -notmatch '^[a-f0-9]{40}$') { throw '元アプリの版を確認できませんでした。' }
    Send-InstallerEvent $Context 'progress' '元アプリのソースを取得しています。GitやNode.jsのインストールは不要です。' $null
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $sourceDirectory = Join-Path $Context.DataRoot 'source'
    [void](New-Item -ItemType Directory -Path $sourceDirectory -Force)
    $archivePath = Join-Path $sourceDirectory ($SourceSha + '.zip')
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/kazunyon/situgosyou/archive/$SourceSha.zip" -OutFile $archivePath -TimeoutSec 180
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
    $files = @{}
    $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
    try {
        foreach ($entry in $zip.Entries) {
            Assert-NotCancelled $Context
            if ($entry.FullName.EndsWith('/')) { continue }
            $relativePath = ($entry.FullName -split '/', 2)[1]
            if (-not $relativePath -or $relativePath -match '(^|/)\.\.(/|$)|\\|^/' -or $entry.Length -gt 10MB) { throw 'ソース内に扱えないファイルがあります。' }
            # Build inputs only. Never copy environment files or inherited workflows.
            if ($relativePath -notmatch '^(src/|public/|tests/|package(?:-lock)?\.json$|tsconfig[^/]*\.json$|index\.html$|vite\.config\.ts$|\.gitignore$|LICENSE(?:\.[^/]+)?$|NOTICE(?:\.[^/]+)?$)') { continue }
            $stream = $entry.Open()
            $memory = New-Object IO.MemoryStream
            try { $stream.CopyTo($memory); $bytes = $memory.ToArray() }
            finally { $stream.Dispose(); $memory.Dispose() }
            $text = $null
            if ($relativePath -notmatch '\.(png|jpe?g|gif|webp|ico|woff2?|ttf|mp[34])$') {
                try { $text = $utf8.GetString($bytes) } catch { }
            }
            $files[$relativePath] = [pscustomobject]@{ Text = $text; Bytes = $bytes }
        }
    } finally { $zip.Dispose() }
    if (-not $files.ContainsKey('src/App.tsx') -or -not $files.ContainsKey('index.html') -or -not $files.ContainsKey('package-lock.json')) { throw '元アプリの必要なファイルが不足しています。' }
    return $files
}

function Publish-InstallerApp {
    param($Context, [string]$Owner, [string]$Repository, [string]$AppName, [string]$SupabaseUrl, [string]$SupabaseKey)
    Assert-InstallerSettings $Owner $Repository $AppName
    $SupabaseUrl = ConvertTo-InstallerSupabaseUrl $SupabaseUrl
    Assert-InstallerSupabase $SupabaseUrl $SupabaseKey
    $SupabaseUrl = $SupabaseUrl.TrimEnd('/')
    Send-InstallerEvent $Context 'progress' '入力した自分のSupabaseの初期設定を確認しています。' $null
    Test-InstallerSupabase $SupabaseUrl $SupabaseKey
    $connectionFingerprint = Get-InstallerConnectionFingerprint $SupabaseUrl $SupabaseKey
    $Context.GhPath = Get-InstallerGh $Context
    $user = Invoke-InstallerApi $Context 'user'
    if ($user.login -ine $Owner) { throw "ログイン中は $($user.login) さんです。入力したGitHubユーザー名と一致していません。ログイン中の名前を入力してください。" }
    $Owner = $user.login
    $fullName = "$Owner/$Repository"
    $statePath = Join-Path $Context.DataRoot "state/$Owner--$Repository.json"
    $state = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    $repo = Invoke-InstallerApi $Context "repos/$fullName" -AllowNotFound
    if (-not $repo) {
        Send-InstallerEvent $Context 'progress' 'あなたのGitHubに新しい公開用コピーを作成しています。' $null
        $sourceRepository = Invoke-InstallerApi $Context 'repos/kazunyon/situgosyou'
        $sourceRef = Invoke-InstallerApi $Context "repos/kazunyon/situgosyou/git/ref/heads/$([uri]::EscapeDataString($sourceRepository.default_branch))"
        $state = [pscustomobject]@{ Stage = 'creating'; RepositoryId = $null; StartedAt = [datetime]::UtcNow.ToString('o'); BaseSha = $null; CommitSha = $null; AppName = $AppName; SourceSha = $sourceRef.object.sha; CreationTag = [guid]::NewGuid().ToString('N'); ConnectionFingerprint=$connectionFingerprint }
        Write-InstallerState $statePath $state
        $created = Invoke-InstallerApi $Context 'user/repos' 'POST' @{ name = $Repository; description = ('Supabase sync Kotoba Memo PWA (installer:' + $state.CreationTag + ')'); private = $false; auto_init = $true }
        if ($created.full_name -ine $fullName) { throw '作成したリポジトリが入力した公開先と一致しません。停止しました。' }
        $state.RepositoryId = $created.id; Write-InstallerState $statePath $state
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            Wait-InstallerStep $Context 3
            $repo = Invoke-InstallerApi $Context "repos/$fullName" -AllowNotFound
            if ($repo) { break }
        }
        if (-not $repo) { throw 'GitHubのリポジトリ作成がまだ終わっていません。少し待ってから同じ入力で再試行してください。' }
    }
    Assert-InstallerRepository $repo $state $fullName
    if (-not $state.ConnectionFingerprint -or $state.ConnectionFingerprint -cne $connectionFingerprint) { throw '前回とSupabaseの接続設定が異なります。旧端末内版は別の新しいリポジトリ名で準備してください。途中処理の再試行は同じ設定を入力します。' }
    if ($state.AppName -cne $AppName) { throw '前回の途中処理とアプリ表示名が異なります。前回と同じ表示名で再試行してください。' }
    $state.RepositoryId = $repo.id
    $branch = $repo.default_branch
    $branchPath = [uri]::EscapeDataString($branch)
    $ref = $null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $ref = Invoke-InstallerApi $Context "repos/$fullName/git/ref/heads/$branchPath" -AllowNotFound
        if ($ref) { break }
        Wait-InstallerStep $Context 3
    }
    if (-not $ref) { throw 'コピー先のファイル準備が終わっていません。同じ入力で再試行してください。' }
    if (-not $state.BaseSha) { $state.BaseSha = $ref.object.sha; $state.Stage = 'forked'; Write-InstallerState $statePath $state }
    if (-not $state.CommitSha) {
        if ($ref.object.sha -ne $state.BaseSha) { throw 'コピー先に別の変更が加えられています。上書きを避けるため停止しました。' }
        Send-InstallerEvent $Context 'progress' '表示名・公開URL・入力したSupabaseの同期設定を保存しています。' $null
        $sourceFiles = Get-InstallerArchiveFiles $Context $state.SourceSha
        $files = New-InstallerFiles $Repository $AppName $branch $sourceFiles['index.html'].Text $sourceFiles['src/App.tsx'].Text $SupabaseUrl $SupabaseKey
        $baseCommit = Invoke-InstallerApi $Context "repos/$fullName/git/commits/$($state.BaseSha)"
        $entries = New-Object 'System.Collections.Generic.List[object]'
        foreach ($path in $sourceFiles.Keys) {
            if ($files.ContainsKey($path)) { continue }
            $file = $sourceFiles[$path]
            if ($null -ne $file.Text) { $entries.Add(@{ path = $path; mode = '100644'; type = 'blob'; content = $file.Text }) }
            else {
                $blob = Invoke-InstallerApi $Context "repos/$fullName/git/blobs" 'POST' @{ encoding = 'base64'; content = [Convert]::ToBase64String($file.Bytes) }
                $entries.Add(@{ path = $path; mode = '100644'; type = 'blob'; sha = $blob.sha })
            }
        }
        foreach ($path in $files.Keys) { $entries.Add(@{ path = $path; mode = '100644'; type = 'blob'; content = $files[$path] }) }
        $entries.Add(@{ path = 'README.md'; mode = '100644'; type = 'blob'; content = "# $AppName`n`nThis PWA syncs using the installer's own Supabase project. Sign in with the same email on PC and phone.`n`nPC: https://$($Owner.ToLowerInvariant()).github.io/$Repository/install.html`n`nPhone: https://$($Owner.ToLowerInvariant()).github.io/$Repository/mobile-install.html`n`nSource version: kazunyon/situgosyou@$($state.SourceSha); sync code from the bundled installer template.`n" })
        $tree = Invoke-InstallerApi $Context "repos/$fullName/git/trees" 'POST' @{ base_tree = $baseCommit.tree.sha; tree = @($entries.ToArray()) }
        $commit = Invoke-InstallerApi $Context "repos/$fullName/git/commits" 'POST' @{ message = 'Set up personal Supabase sync Kotoba Memo PWA'; tree = $tree.sha; parents = @($state.BaseSha) }
        $state.CommitSha = $commit.sha; $state.Stage = 'commit-created'; Write-InstallerState $statePath $state
    }
    $ref = Invoke-InstallerApi $Context "repos/$fullName/git/ref/heads/$branchPath"
    if ($ref.object.sha -eq $state.BaseSha) {
        [void](Invoke-InstallerApi $Context "repos/$fullName/git/refs/heads/$branchPath" 'PATCH' @{ sha = $state.CommitSha; force = $false })
    } elseif ($ref.object.sha -ne $state.CommitSha) { throw 'コピー先に別の変更が加えられています。上書きを避けるため停止しました。' }
    $state.Stage = 'configured'; Write-InstallerState $statePath $state
    Send-InstallerEvent $Context 'repository' '公開先リポジトリを準備しました。' "https://github.com/$fullName"
    Send-InstallerEvent $Context 'progress' 'GitHub Pagesと公開処理を設定しています。' $null
    $pages = Invoke-InstallerApi $Context "repos/$fullName/pages" -AllowNotFound
    if (-not $pages) { [void](Invoke-InstallerApi $Context "repos/$fullName/pages" 'POST' @{ build_type = 'workflow' }) }
    elseif ($pages.build_type -ne 'workflow') { [void](Invoke-InstallerApi $Context "repos/$fullName/pages" 'PUT' @{ build_type = 'workflow' }) }
    [void](Invoke-InstallerApi $Context "repos/$fullName/actions/permissions" 'PUT' @{ enabled = $true })
    $workflowInfo = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $workflowInfo = Invoke-InstallerApi $Context "repos/$fullName/actions/workflows/deploy-pages.yml" -AllowNotFound
        if ($workflowInfo) { break }
        Wait-InstallerStep $Context 3
    }
    if (-not $workflowInfo) { throw '公開用workflowの準備がまだ終わっていません。同じ入力で再試行してください。' }
    [void](Invoke-InstallerApi $Context "repos/$fullName/actions/workflows/deploy-pages.yml/enable" 'PUT')
    $dispatchedAt = [datetime]::UtcNow
    [void](Invoke-InstallerApi $Context "repos/$fullName/actions/workflows/deploy-pages.yml/dispatches" 'POST' @{ ref = $branch })
    Send-InstallerEvent $Context 'progress' '公開処理を実行しています。数分かかることがあります。' $null
    $run = $null
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        Wait-InstallerStep $Context 5
        $runs = Invoke-InstallerApi $Context "repos/$fullName/actions/workflows/deploy-pages.yml/runs?event=workflow_dispatch&per_page=10"
        $run = $runs.workflow_runs | Where-Object { $_.head_sha -eq $state.CommitSha -and [datetime]$_.created_at -ge $dispatchedAt.AddSeconds(-2) } | Select-Object -First 1
        if (-not $run) { continue }
        if ($attempt -eq 0 -or $attempt % 6 -eq 0) { Send-InstallerEvent $Context 'run' "公開処理の状態：$($run.status)" $run.html_url }
        if ($run.status -eq 'completed') { break }
    }
    if (-not $run -or $run.status -ne 'completed') { throw "公開が時間内に完了しませんでした。https://github.com/$fullName/actions で結果を確認し、同じ入力で再試行できます。" }
    if ($run.conclusion -ne 'success') { throw "公開処理が成功しませんでした（$($run.conclusion)）。$($run.html_url) で説明を確認してから再試行してください。" }
    Send-InstallerEvent $Context 'run' 'GitHubの公開処理が成功しました。' $run.html_url
    $siteUrl = "https://$($Owner.ToLowerInvariant()).github.io/$Repository/"
    Send-InstallerEvent $Context 'progress' '公開されたページとPWAの設定を確認しています。' $null
    $verified = $false
    for ($attempt = 0; $attempt -lt 24; $attempt++) {
        Assert-NotCancelled $Context
        try {
            $html = (Invoke-WebRequest -UseBasicParsing -Uri $siteUrl -TimeoutSec 20).Content
            $manifest = Invoke-RestMethod -Uri ($siteUrl + 'manifest.webmanifest') -TimeoutSec 20
            $publishedConfig = Invoke-RestMethod -Uri ($siteUrl + 'installer-config.json') -TimeoutSec 20
            $mobileHtml = (Invoke-WebRequest -UseBasicParsing -Uri ($siteUrl + 'mobile-install.html') -TimeoutSec 20).Content
            $expectedTitle = '<title>' + [Security.SecurityElement]::Escape($AppName) + '</title>'
            if ($html.Contains($expectedTitle) -and $manifest.name -ceq $AppName -and $manifest.start_url -ceq "/$Repository/" -and $publishedConfig.storageMode -ceq 'supabase' -and $publishedConfig.supabaseUrl -ceq $SupabaseUrl -and $publishedConfig.appName -ceq $AppName -and $mobileHtml.Contains('使うスマホ')) { $verified = $true; break }
        } catch { }
        Wait-InstallerStep $Context 5
    }
    if (-not $verified) { throw "公開処理は成功しましたが、ページと表示名の確認がまだできません。$siteUrl を確認してから再試行してください。" }
    $state.Stage = 'published'; Write-InstallerState $statePath $state
    Send-InstallerEvent $Context 'published' '公開が完了しました。次に「ブラウザでアプリを開く」を押してください。' $siteUrl
}

Export-ModuleMember -Function Assert-InstallerSettings, ConvertTo-InstallerSupabaseUrl, Assert-InstallerSupabase, Test-InstallerSupabase, Get-InstallerSetupSql, ConvertTo-WindowsArgument, New-InstallerFiles, Assert-InstallerRepository, Write-InstallerState, Get-InstallerGh, Connect-InstallerGitHub, Publish-InstallerApp
