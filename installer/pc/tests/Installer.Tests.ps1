#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$module = Import-Module (Join-Path (Split-Path $PSScriptRoot) 'Installer.Core.psm1') -Force -PassThru
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('kotoba-installer-checks-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$script:passed = 0
function Assert-True([bool]$Value, [string]$Name) { if (-not $Value) { throw "FAIL: $Name" }; $script:passed++; Write-Output "PASS: $Name" }
function Assert-Rejected([scriptblock]$Action, [string]$Name) { $rejected = $false; try { & $Action } catch { $rejected = $true }; Assert-True $rejected $Name }
try {
    Assert-InstallerSettings 'hanako' 'personal-memo' 'はなこのことばメモ'
    Assert-Rejected { Assert-InstallerSettings 'hanako@example.com' 'memo' 'メモ' } 'Username must not be email'
    Assert-Rejected { Assert-InstallerSettings 'hanako' '../memo' 'メモ' } 'Path traversal is rejected'
    Assert-Rejected { Assert-InstallerSettings 'hanako' 'hanako.github.io' 'メモ' } 'User site is rejected'
    Assert-Rejected { Assert-InstallerSettings 'kazunyon' 'situgosyou' 'メモ' } 'Author source cannot be a target'
    Assert-Rejected { Assert-InstallerSettings 'hanako' 'memo' "メモ`n次の行" } 'Newlines in app name are rejected'
    $index = Get-Content -LiteralPath (Join-Path $projectRoot 'index.html') -Raw -Encoding UTF8
    $app = Get-Content -LiteralPath (Join-Path $projectRoot 'src/App.tsx') -Raw -Encoding UTF8
    $displayName = 'はなこ "引用" {文字} ' + [char]60 + '/script>'
    $files = New-InstallerFiles 'hanako.memo' $displayName 'main' $index $app
    $cloudUrl = 'https://abcdefghijklmnopqrst.supabase.co'
    $cloudKey = 'sb_publishable_testPublicKey1234567890'
    Assert-InstallerSupabase $cloudUrl $cloudKey
    Assert-Rejected { Assert-InstallerSupabase 'https://example.com' $cloudKey } 'Only hosted Supabase Project URLs are accepted'
    Assert-Rejected { Assert-InstallerSupabase $cloudUrl 'sb_secret_mustNotBeUsed' } 'Secret keys are rejected'
    Assert-Rejected { Assert-InstallerSupabase $cloudUrl 'not-a-public-key' } 'Invalid connection keys are rejected'
    $creatingState = [pscustomobject]@{ Stage='creating'; RepositoryId=$null; CreationTag='own-tag'; StartedAt=[datetime]::UtcNow.ToString('o'); ConnectionFingerprint='own-config-hash' }
    $createdRepo = [pscustomobject]@{ full_name='hanako/personal-memo'; id=42; description='Supabase sync Kotoba Memo PWA (installer:own-tag)'; created_at=[datetime]::UtcNow.ToString('o') }
    Assert-InstallerRepository $createdRepo $creatingState 'hanako/personal-memo'
    Assert-True $true 'A created cloud repository can resume after its ID response was interrupted'
    $createdRepo.description='Supabase sync Kotoba Memo PWA (installer:another-tag)'
    Assert-Rejected { Assert-InstallerRepository $createdRepo $creatingState 'hanako/personal-memo' } 'Interrupted creation cannot adopt another repository'
    $cloudFiles = New-InstallerFiles 'hanako.memo' $displayName 'main' $index $app $cloudUrl $cloudKey
    Assert-True ($cloudFiles['src/installer-connection.ts'].Contains($cloudUrl) -and $cloudFiles['src/installer-connection.ts'].Contains($cloudKey)) 'Only supplied public Supabase settings are generated'
    Assert-True ($cloudFiles['public/installer-config.json'].Contains('supabase') -and $cloudFiles.ContainsKey('src/cloud-sync.ts') -and $cloudFiles.ContainsKey('public/supabase-setup.sql')) 'Sync template and setup SQL are bundled into the published app'
    Assert-True ($files['vite.config.ts'].Contains("'/hanako.memo/'")) 'Custom repository path is used'
    Assert-True ($files['.github/workflows/deploy-pages.yml'].Contains("VITE_SUPABASE_URL: ''") -and $files['.github/workflows/deploy-pages.yml'].Contains("VITE_SUPABASE_ANON_KEY: ''")) 'Supabase settings are forced empty'
    Assert-True (-not $files['.github/workflows/deploy-pages.yml'].Contains('secrets.')) 'No inherited secrets are used'
    Assert-True ($files['index.html'].Contains('&lt;/script&gt;')) 'HTML display name is escaped'
    Assert-True ([regex]::Matches($files['public/install.html'], '\x3cscript>').Count -eq 1) 'Display name cannot inject scripts'
    Assert-True ($files['public/install.html'].Contains('beforeinstallprompt') -and $files['public/install.html'].Contains('appinstalled')) 'PWA uses browser consent and actual installation events'
    Assert-Rejected { New-InstallerFiles 'memo' 'メモ' 'main' $index 'changed-source' } 'Changed upstream source stops publication'
    foreach ($file in @('src/App.tsx','vite.config.ts','public/install.html')) { [IO.File]::WriteAllText((Join-Path $testRoot (Split-Path $file -Leaf)), $files[$file], (New-Object Text.UTF8Encoding($false))) }
    $checkScript = Join-Path $testRoot 'check.cjs'
    $javascript = "const fs=require('fs'),vm=require('vm'),ts=require(process.argv[2]);for(const filename of ['App.tsx','vite.config.ts']){const r=ts.transpileModule(fs.readFileSync(__dirname+'/'+filename,'utf8'),{fileName:filename,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});if((r.diagnostics||[]).some(d=>d.category===ts.DiagnosticCategory.Error))throw Error(filename);}new vm.Script(fs.readFileSync(__dirname+'/install.html','utf8').match(/\x3cscript>([\s\S]*?)\x3c\/script>/)[1]);"
    [IO.File]::WriteAllText($checkScript, $javascript, (New-Object Text.UTF8Encoding($false)))
    & node.exe $checkScript (Join-Path $projectRoot 'node_modules/typescript')
    Assert-True ($LASTEXITCODE -eq 0) 'Generated TypeScript and JavaScript parse correctly'
    $context = [pscustomobject]@{ Queue = New-Object 'Collections.Concurrent.ConcurrentQueue[object]'; Cancellation = New-Object Threading.CancellationTokenSource; DataRoot = $testRoot; GhPath = (Get-Command gh.exe).Source }
    $version = & $module { param($ctx) Invoke-GhCommand $ctx @('--version') } $context
    Assert-True ($version.ExitCode -eq 0 -and $version.Output -match 'gh version') 'Native CLI process can run without network'
    $context.GhPath = (Get-Command node.exe).Source
    $argv = @('spaces and "quotes"', 'trailing\', '$() & ; literal', '日本語')
    $nodeCode = 'process.stdout.write(JSON.stringify({args:process.argv.slice(1),input:require("fs").readFileSync(0,"utf8"),token:!!process.env.GH_TOKEN}))'
    $native = & $module { param($ctx,$arguments) Invoke-GhCommand $ctx $arguments '日本語の入力' } $context (@('-e',$nodeCode,'--') + $argv)
    $decoded = $native.Output | ConvertFrom-Json
    for ($i=0; $i -lt $argv.Count; $i++) { Assert-True ($decoded.args[$i] -ceq $argv[$i]) "Windows argument $i is passed literally" }
    Assert-True ($decoded.input -ceq '日本語の入力') 'UTF-8 request input has no BOM or encoding corruption'
    Assert-True (-not $decoded.token) 'Native process does not inherit a GitHub token'
    $context.Cancellation.Cancel()
    Assert-Rejected { & $module { param($ctx) Invoke-GhCommand $ctx @('--version') } $context } 'Cancellation stops startup'
    $context.Cancellation.Dispose()

    & $module {
        param($sourceIndex, $sourceApp)
        $script:testIndex=$sourceIndex; $script:testApp=$sourceApp
        $script:calls=New-Object 'Collections.Generic.List[object]'
        $script:repoExists=$false; $script:head='base-sha'; $script:mode='normal'; $script:pages=$false
        Set-Item Function:script:Get-InstallerGh { param($Context) 'simulated-gh' }
        Set-Item Function:script:Test-InstallerSupabase { param($Url,$Key) Assert-InstallerSupabase $Url $Key }
        Set-Item Function:script:Wait-InstallerStep { param($Context,$Seconds) Assert-NotCancelled $Context }
        Set-Item Function:script:Get-InstallerArchiveFiles {
            param($Context,$SourceSha)
            @{
              'index.html'=[pscustomobject]@{Text=$script:testIndex;Bytes=$null}
              'src/App.tsx'=[pscustomobject]@{Text=$script:testApp;Bytes=$null}
              'package-lock.json'=[pscustomobject]@{Text='{}';Bytes=$null}
              'public/pwa-192x192.png'=[pscustomobject]@{Text=$null;Bytes=[byte[]]@(137,80,78,71)}
            }
        }
        Set-Item Function:script:Invoke-WebRequest { param([switch]$UseBasicParsing,$Uri,$TimeoutSec) [pscustomobject]@{Content='<title>はなこのことばメモ</title>使うスマホ'} }
        Set-Item Function:script:Invoke-RestMethod { param($Uri,$TimeoutSec) if ($Uri -like '*installer-config.json') { [pscustomobject]@{storageMode='supabase';supabaseUrl='https://abcdefghijklmnopqrst.supabase.co';appName='はなこのことばメモ'} } else { [pscustomobject]@{name='はなこのことばメモ';start_url='/personal-memo/'} } }
        Set-Item Function:script:Invoke-InstallerApi {
            param($Context,$Endpoint,$Method='GET',$Body,[switch]$AllowNotFound)
            $script:calls.Add([pscustomobject]@{Endpoint=$Endpoint;Method=$Method;Body=$Body})
            switch -Regex ($Endpoint) {
              '^user$' {return [pscustomobject]@{login=$(if($script:mode -eq 'mismatch'){'different-user'}else{'hanako'});type='User'}}
              '^repos/kazunyon/situgosyou$' {return [pscustomobject]@{default_branch='main'}}
              '^repos/kazunyon/situgosyou/git/ref/heads/main$' {return [pscustomobject]@{object=[pscustomobject]@{sha=('1'*40)}}}
              '^user/repos$' {$script:repoExists=$true;return [pscustomobject]@{full_name='hanako/personal-memo';id=42}}
              '^repos/hanako/personal-memo$' {if(-not $script:repoExists){return $null};return [pscustomobject]@{full_name='hanako/personal-memo';id=42;default_branch='main';created_at=[datetime]::UtcNow.ToString('o')}}
              '^repos/hanako/personal-memo/git/ref/heads/main$' {return [pscustomobject]@{object=[pscustomobject]@{sha=$script:head}}}
              '^repos/hanako/personal-memo/git/commits/base-sha$' {return [pscustomobject]@{tree=[pscustomobject]@{sha='base-tree'}}}
              '^repos/hanako/personal-memo/git/blobs$' {return [pscustomobject]@{sha='image-blob'}}
              '^repos/hanako/personal-memo/git/trees$' {$script:entries=$Body.tree;return [pscustomobject]@{sha='new-tree'}}
              '^repos/hanako/personal-memo/git/commits$' {return [pscustomobject]@{sha='installer-commit'}}
              '^repos/hanako/personal-memo/git/refs/heads/main$' {if($Body.force){throw 'Force push'};$script:head=$Body.sha;return $null}
              '^repos/hanako/personal-memo/pages$' {if($Method -ne 'GET'){$script:pages=$true;return $null};if($script:pages){return [pscustomobject]@{build_type='workflow'}};return $null}
              '^repos/hanako/personal-memo/actions/workflows/deploy-pages.yml$' {return [pscustomobject]@{id=7}}
              '^repos/hanako/personal-memo/actions/workflows/deploy-pages.yml/runs' {return [pscustomobject]@{workflow_runs=@([pscustomobject]@{head_sha='installer-commit';created_at=[datetime]::UtcNow.ToString('o');status='completed';conclusion='success';html_url='https://github.com/hanako/personal-memo/actions/runs/1'})}}
              '^repos/hanako/personal-memo/actions/(permissions|workflows/deploy-pages.yml/(enable|dispatches))$' {return $null}
              default {throw "Unexpected route: $Method $Endpoint"}
            }
        }
    } $index $app
    $context=[pscustomobject]@{Queue=New-Object 'Collections.Concurrent.ConcurrentQueue[object]';Cancellation=New-Object Threading.CancellationTokenSource;DataRoot=(Join-Path $testRoot 'normal');GhPath=''}
    Publish-InstallerApp $context 'hanako' 'personal-memo' 'はなこのことばメモ' $cloudUrl $cloudKey
    Assert-True (@($context.Queue.ToArray() | Where-Object Kind -eq 'published').Count -eq 1) 'Full preparation reaches verified publication with simulated API'
    $calls=& $module {$script:calls.ToArray()}
    Assert-True (@($calls | Where-Object {$_.Method -ne 'GET' -and $_.Endpoint -like 'repos/kazunyon/*'}).Count -eq 0) 'Author repository is never changed'
    $entries=& $module {$script:entries}
    Assert-True (@($entries | Where-Object {$_.path -eq 'public/pwa-192x192.png' -and $_.sha -eq 'image-blob'}).Count -eq 1) 'Binary icon is retained as a Git blob'
    Assert-True (@($entries | Where-Object path -eq 'public/install.html').Count -eq 1) 'Personal installer page is in the published tree'
    $state=Get-Content (Join-Path $context.DataRoot 'state/hanako--personal-memo.json') -Raw | ConvertFrom-Json
    Assert-True ($state.Stage -eq 'published' -and $state.RepositoryId -eq 42) 'Resume state records exact repository identity'
    Publish-InstallerApp $context 'hanako' 'personal-memo' 'はなこのことばメモ' $cloudUrl $cloudKey
    $calls=& $module {$script:calls.ToArray()}
    Assert-True (@($calls | Where-Object Endpoint -eq 'user/repos').Count -eq 1) 'Retry does not create a second repository'
    Assert-Rejected {Publish-InstallerApp $context 'hanako' 'personal-memo' '別の名前' $cloudUrl $cloudKey} 'Retry cannot overwrite with a different display name'
    Assert-Rejected {Publish-InstallerApp $context 'hanako' 'personal-memo' 'はなこのことばメモ' $cloudUrl 'sb_publishable_differentPublicKey12345'} 'Retry cannot switch the Supabase connection'
    & $module {$script:head='remote-change'}
    Assert-Rejected {Publish-InstallerApp $context 'hanako' 'personal-memo' 'はなこのことばメモ' $cloudUrl $cloudKey} 'Concurrent remote changes are protected'
    & $module {$script:mode='mismatch'}
    Assert-Rejected {Publish-InstallerApp $context 'hanako' 'personal-memo' 'はなこのことばメモ' $cloudUrl $cloudKey} 'GitHub account mismatch is rejected'
    & $module {$script:mode='normal'}
    $context.DataRoot=Join-Path $testRoot 'unrelated'
    Assert-Rejected {Publish-InstallerApp $context 'hanako' 'personal-memo' 'はなこのことばメモ' $cloudUrl $cloudKey} 'Existing unrelated repository is not overwritten'
    $context.Cancellation.Dispose()
    Write-Output "All $script:passed checks passed. No real GitHub repositories were changed."
} finally {
    Remove-Module $module.Name -ErrorAction SilentlyContinue
    $resolvedTestRoot=[IO.Path]::GetFullPath($testRoot)
    $resolvedTempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if($resolvedTestRoot.StartsWith($resolvedTempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTestRoot -Leaf) -like 'kotoba-installer-checks-*') {Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force}
}
