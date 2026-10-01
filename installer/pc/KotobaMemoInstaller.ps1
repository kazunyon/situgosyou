#requires -Version 5.1
param([switch]$SmokeTest, [string]$PreviewPath)

try {
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
    Import-Module (Join-Path $PSScriptRoot 'Installer.Core.psm1') -Force
    [xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    Title="ことばメモ：PCインストールツール" Width="820" Height="900" MinWidth="640" MinHeight="600"
    WindowStartupLocation="CenterScreen" Background="#F3F6FB" FontFamily="Yu Gothic UI" FontSize="17">
  <Window.Resources>
    <Style TargetType="Button"><Setter Property="Padding" Value="16,12"/><Setter Property="Margin" Value="0,8,0,0"/><Setter Property="MinHeight" Value="48"/></Style>
    <Style TargetType="TextBox"><Setter Property="Padding" Value="10,8"/><Setter Property="MinHeight" Value="42"/><Setter Property="VerticalContentAlignment" Value="Center"/></Style>
  </Window.Resources>
  <ScrollViewer VerticalScrollBarVisibility="Auto"><StackPanel Margin="28">
    <TextBlock Text="ことばメモを、このPCに" FontSize="29" FontWeight="Bold" Foreground="#183047"/>
    <TextBlock Margin="0,10,0,18" TextWrapping="Wrap" Text="あなたのGitHubにアプリを公開し、あなた自身のSupabaseでPCとスマホのメモを同期します。両方で同じメールアドレスを使います。"/>
    <Border Background="#E7F0FF" Padding="16" CornerRadius="10"><TextBlock TextWrapping="Wrap" Text="必要なもの：自分のGitHub・Supabaseアカウント、専用のSupabaseプロジェクト、確認コードを受け取るメール、インターネット、EdgeまたはChrome。公開リポジトリにはアプリとブラウザ用公開キーが含まれます。メモは公開しません。"/></Border>
    <TextBlock Margin="0,20,0,4" Text="GitHubユーザー名" FontWeight="Bold"/>
    <TextBox x:Name="Owner" MaxLength="39" AutomationProperties.Name="GitHubユーザー名"/>
    <TextBlock Text="メールアドレスではありません。ログイン後に自動入力できます。" Foreground="#536579" FontSize="14" TextWrapping="Wrap"/>
    <TextBlock Margin="0,12,0,4" Text="公開用リポジトリ名" FontWeight="Bold"/>
    <TextBox x:Name="Repository" Text="kotoba-memo-sync" MaxLength="64" AutomationProperties.Name="公開用リポジトリ名"/>
    <TextBlock Text="例：hanako-memo。半角英数字などで入力します。既存の別リポジトリは上書きしません。" Foreground="#536579" FontSize="14" TextWrapping="Wrap"/>
    <TextBlock Margin="0,12,0,4" Text="アプリの表示名" FontWeight="Bold"/>
    <TextBox x:Name="AppName" Text="ことばメモ" MaxLength="40" AutomationProperties.Name="アプリの表示名"/>
    <TextBlock Text="例：はなこのことばメモ。PCのアプリ一覧とアプリ画面に表示します。" Foreground="#536579" FontSize="14" TextWrapping="Wrap"/>
    <Button x:Name="OpenSetup" Content="最初に：Gmail・Supabaseの準備をブラウザで案内する"/>
    <TextBlock Margin="0,18,0,4" Text="自分のSupabase Project URL（管理画面のURLも貼り付けできます）" FontWeight="Bold"/>
    <TextBox x:Name="SupabaseUrl" AutomationProperties.Name="自分のSupabase Project URL"/>
    <TextBlock Text="https://プロジェクトID.supabase.co を貼り付けます。作者の設定は入力されていません。" Foreground="#536579" FontSize="14" TextWrapping="Wrap"/>
    <TextBlock Margin="0,12,0,4" Text="Supabase Publishable key（または旧anonキー）" FontWeight="Bold"/>
    <TextBox x:Name="SupabaseKey" AutomationProperties.Name="Supabase公開キー"/>
    <TextBlock Text="sb_publishable_ で始まるブラウザ用公開キーです。secret・service_role・DBパスワードは入力しません。" Foreground="#536579" FontSize="14" TextWrapping="Wrap"/>
    <Button x:Name="OpenSupabase" Content="Supabaseの管理画面を開く"/>
    <Button x:Name="CopySql" Content="自分のSupabaseに使う初期設定SQLをコピー"/>
    <TextBlock Text="新しい専用プロジェクトを作成し、SQL Editorで右クリック → 貼り付け → Run。その後、メール認証と確認コードのメールテンプレートを設定します。一般利用者へのメール送信にはカスタムSMTPも必要です。同梱手順書を参照してください。" Foreground="#536579" FontSize="14" TextWrapping="Wrap"/>
    <CheckBox x:Name="SetupConfirmed" Margin="0,12,0,0" Padding="8" AutomationProperties.Name="自分のSupabaseの準備を確認"><TextBlock TextWrapping="Wrap" Text="自分の専用プロジェクトにSQLを実行し、メール認証を準備しました"/></CheckBox>
    <TextBlock Margin="0,12,0,4" Text="インストールに使うブラウザ" FontWeight="Bold"/>
    <ComboBox x:Name="Browser" SelectedIndex="0" Padding="10" AutomationProperties.Name="インストールに使うブラウザ"><ComboBoxItem Content="Edge"/><ComboBoxItem Content="Chrome"/></ComboBox>
    <TextBlock Margin="0,12,0,4" Text="公開先URL（入力内容から決まります）" FontWeight="Bold"/>
    <TextBox x:Name="SiteUrl" IsReadOnly="True" AutomationProperties.Name="公開先URL"/>
    <Button x:Name="Login" Content="1. GitHubにログイン"/>
    <TextBlock x:Name="LoginStatus" Margin="0,6,0,0" TextWrapping="Wrap" Text="GitHubのパスワードや接続キーをこの画面へ入力する必要はありません。"/>
    <Border x:Name="CodePanel" Visibility="Collapsed" Background="#FFF5D9" Margin="0,10,0,0" Padding="14" CornerRadius="8"><StackPanel>
      <TextBlock Text="GitHubの確認コード" FontWeight="Bold"/>
      <TextBox x:Name="AuthCode" IsReadOnly="True" FontSize="25"/>
      <TextBlock Text="コードをコピーし、GitHubの画面で右クリック → 貼り付け。続いてGitHub CLIを許可します。" TextWrapping="Wrap"/>
      <Button x:Name="CopyCode" Content="確認コードをコピー"/>
      <Button x:Name="OpenAuth" Content="GitHubのログイン画面を開く"/>
    </StackPanel></Border>
    <Button x:Name="Publish" Content="2. 自分の公開先を作成して、アプリを準備する" IsEnabled="False"/>
    <ProgressBar x:Name="Progress" Height="8" Margin="0,12,0,8" Visibility="Collapsed" IsIndeterminate="True"/>
    <TextBlock x:Name="Status" Text="まだ公開していません。入力とログインを済ませてから、2のボタンを押してください。" TextWrapping="Wrap" FontWeight="Bold" Foreground="#183047"/>
    <TextBox x:Name="Log" Margin="0,10,0,0" IsReadOnly="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" Height="130" FontSize="14" AutomationProperties.Name="進行状況"/>
    <WrapPanel><Button x:Name="OpenRepo" Content="公開用リポジトリを見る" IsEnabled="False" Margin="0,8,10,0"/><Button x:Name="OpenRun" Content="公開処理の結果を見る" IsEnabled="False"/></WrapPanel>
    <Button x:Name="Install" Content="3. ブラウザでアプリを開く（インストール不要）" IsEnabled="False" Background="#D9E8FF"/>
    <TextBlock Text="ホーム画面やスタートへのPWA追加は任意です。公開URLをスマホで開き、同じメールでログインすれば同期できます。" TextWrapping="Wrap"/>
    <TextBlock Margin="0,10,0,0" TextWrapping="Wrap" Text="まずブラウザでメールの確認コードを使ってログインし、設定でカテゴリを1件追加してください。公開URLをスマホでも開き、同じメールでログインして双方向の変更を確認します。PWA追加は任意です。"/>
    <TextBlock Margin="0,8,0,0" TextWrapping="Wrap" Foreground="#536579" FontSize="14" Text="スマホでは公開先の mobile-install.html を開きます。PCと同じメールアドレスでログインし、PC → スマホとスマホ → PCの変更を確認してください。"/>
    <Button x:Name="Cancel" Content="実行中の処理を中止" IsEnabled="False"/>
  </StackPanel></ScrollViewer>
</Window>
'@
    $reader = New-Object System.Xml.XmlNodeReader $xaml
    $script:window = [Windows.Markup.XamlReader]::Load($reader)
    $script:controls = @{}
    foreach ($name in @('Owner', 'Repository', 'AppName', 'SupabaseUrl', 'SupabaseKey', 'OpenSetup', 'OpenSupabase', 'CopySql', 'SetupConfirmed', 'Browser', 'SiteUrl', 'Login', 'LoginStatus', 'CodePanel', 'AuthCode', 'CopyCode', 'OpenAuth', 'Publish', 'Progress', 'Status', 'Log', 'OpenRepo', 'OpenRun', 'Install', 'Cancel')) {
        $script:controls[$name] = $script:window.FindName($name)
        if (-not $script:controls[$name]) { throw "画面の項目が見つかりません：$name" }
    }

    $script:job = $null
    $script:loggedInUser = ''
    $script:publishedUrl = ''
    $script:repositoryUrl = ''
    $script:runUrl = ''
    $script:closeAfterWork = $false
    $script:queue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[object]'
    $script:dataRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'KotobaMemoInstaller'

    function Add-ProgressLine([string]$Message) {
        $script:controls.Log.AppendText((Get-Date -Format 'HH:mm:ss') + '  ' + $Message + [Environment]::NewLine)
        $script:controls.Log.ScrollToEnd()
    }
    function Update-UrlPreview {
        $script:controls.SiteUrl.Text = "https://$($script:controls.Owner.Text.Trim().ToLowerInvariant()).github.io/$($script:controls.Repository.Text.Trim())/"
    }
    function Set-UiBusy([bool]$Busy) {
        foreach ($key in @('Owner', 'Repository', 'AppName', 'SupabaseUrl', 'SupabaseKey', 'SetupConfirmed', 'Browser', 'Login')) { $script:controls[$key].IsEnabled = -not $Busy }
        $script:controls.Publish.IsEnabled = -not $Busy -and -not [string]::IsNullOrEmpty($script:loggedInUser)
        $script:controls.Install.IsEnabled = -not $Busy -and -not [string]::IsNullOrEmpty($script:publishedUrl)
        $script:controls.Cancel.IsEnabled = $Busy
        $script:controls.Progress.Visibility = if ($Busy) { 'Visible' } else { 'Collapsed' }
    }
    function Start-InstallerWork([string]$Action) {
        if ($script:job) { return }
        $settings = [pscustomobject]@{ Owner = $script:controls.Owner.Text.Trim(); Repository = $script:controls.Repository.Text.Trim(); AppName = $script:controls.AppName.Text.Trim(); SupabaseUrl=$script:controls.SupabaseUrl.Text.Trim(); SupabaseKey=$script:controls.SupabaseKey.Text.Trim() }
        if ($Action -eq 'publish') {
            try {
                Assert-InstallerSettings $settings.Owner $settings.Repository $settings.AppName
                try { $settings.SupabaseUrl = ConvertTo-InstallerSupabaseUrl $settings.SupabaseUrl }
                catch { $script:controls.SupabaseUrl.Focus(); $script:controls.SupabaseUrl.SelectAll(); throw }
                if ($script:controls.SupabaseUrl.Text -cne $settings.SupabaseUrl) {
                    $prepared = $script:controls.SetupConfirmed.IsChecked
                    $script:controls.SupabaseUrl.Text = $settings.SupabaseUrl
                    $script:controls.SetupConfirmed.IsChecked = $prepared
                }
                Assert-InstallerSupabase $settings.SupabaseUrl $settings.SupabaseKey
                if (-not $script:controls.SetupConfirmed.IsChecked) { throw '自分のSupabaseの準備を済ませ、確認欄にチェックしてください。' }
                [void](New-Item -ItemType Directory -Path $script:dataRoot -Force)
                [IO.File]::WriteAllText((Join-Path $script:dataRoot 'preferences.json'), (ConvertTo-Json -InputObject $settings), (New-Object Text.UTF8Encoding($false)))
            }
            catch { $script:controls.Status.Text = $_.Exception.Message; return }
            $script:publishedUrl = ''
        }
        $script:controls.AuthCode.Text = ''
        $script:controls.CodePanel.Visibility = 'Collapsed'
        $cancellation = New-Object System.Threading.CancellationTokenSource
        $pipeline = [PowerShell]::Create()
        [void]$pipeline.AddScript(@'
param($ModulePath, $Action, $Settings, $Queue, $Cancellation, $DataRoot)
try {
    Import-Module $ModulePath -Force
    $context = [pscustomobject]@{ Queue = $Queue; Cancellation = $Cancellation; DataRoot = $DataRoot; GhPath = '' }
    if ($Action -eq 'login') { Connect-InstallerGitHub $context }
    else { Publish-InstallerApp $context $Settings.Owner $Settings.Repository $Settings.AppName $Settings.SupabaseUrl $Settings.SupabaseKey }
} catch {
    $Queue.Enqueue([pscustomobject]@{ Kind = 'error'; Message = $_.Exception.Message; Value = $null })
}
'@).AddArgument((Join-Path $PSScriptRoot 'Installer.Core.psm1')).AddArgument($Action).AddArgument($settings).AddArgument($script:queue).AddArgument($cancellation).AddArgument($script:dataRoot)
        Set-UiBusy $true
        $script:controls.Status.Text = if ($Action -eq 'login') { 'GitHubへのログインを準備しています。' } else { '入力した公開先の確認を始めています。' }
        $script:job = [pscustomobject]@{ Pipeline = $pipeline; Handle = $pipeline.BeginInvoke(); Cancellation = $cancellation }
    }
    function Open-WebPage([string]$Url, [switch]$UseSelectedBrowser) {
        if ($Url -notmatch '^https://') { throw '開くURLを確認できませんでした。' }
        if (-not $UseSelectedBrowser) { Start-Process -FilePath $Url; return }
        $browserName = $script:controls.Browser.SelectedItem.Content
        $executable = if ($browserName -eq 'Chrome') { 'chrome.exe' } else { 'msedge.exe' }
        $relativePath = if ($browserName -eq 'Chrome') { 'Google\Chrome\Application\chrome.exe' } else { 'Microsoft\Edge\Application\msedge.exe' }
        $candidates = @()
        foreach ($hive in @('HKCU:', 'HKLM:')) {
            $registryPath = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$executable"
            if (Test-Path -LiteralPath $registryPath) { $candidates += (Get-Item -LiteralPath $registryPath).GetValue('') }
        }
        foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
            if ($root) { $candidates += Join-Path $root $relativePath }
        }
        $browserPath = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
        if (-not $browserPath) { throw "$browserName が見つかりません。インストール済みのブラウザを選んでください。" }
        Start-Process -FilePath $browserPath -ArgumentList @('--new-window', $Url)
    }

    $script:controls.Owner.Add_TextChanged({ Update-UrlPreview; $script:publishedUrl = ''; $script:controls.Install.IsEnabled = $false })
    $script:controls.Repository.Add_TextChanged({ Update-UrlPreview; $script:publishedUrl = ''; $script:controls.Install.IsEnabled = $false })
    $script:controls.AppName.Add_TextChanged({ $script:publishedUrl = ''; $script:controls.Install.IsEnabled = $false })
    $script:controls.SupabaseUrl.Add_TextChanged({ $script:publishedUrl = ''; $script:controls.Install.IsEnabled = $false; $script:controls.SetupConfirmed.IsChecked = $false })
    $script:controls.SupabaseKey.Add_TextChanged({ $script:publishedUrl = ''; $script:controls.Install.IsEnabled = $false; $script:controls.SetupConfirmed.IsChecked = $false })
    $script:controls.OpenSupabase.Add_Click({ Open-WebPage 'https://supabase.com/dashboard' })
    $script:controls.OpenSetup.Add_Click({ Start-Process -FilePath (Join-Path $PSScriptRoot 'Setup.html') })
    $script:controls.CopySql.Add_Click({ [Windows.Clipboard]::SetText((Get-InstallerSetupSql)); $script:controls.Status.Text = 'SQLをコピーしました。自分の新しい専用プロジェクトのSQL Editorへ貼り付けて実行してください。' })
    $script:controls.Login.Add_Click({ Start-InstallerWork 'login' })
    $script:controls.Publish.Add_Click({ Start-InstallerWork 'publish' })
    $script:controls.CopyCode.Add_Click({ [Windows.Clipboard]::SetText($script:controls.AuthCode.Text) })
    $script:controls.OpenAuth.Add_Click({ Open-WebPage 'https://github.com/login/device' })
    $script:controls.OpenRepo.Add_Click({ Open-WebPage $script:repositoryUrl })
    $script:controls.OpenRun.Add_Click({ Open-WebPage $script:runUrl })
    $script:controls.Install.Add_Click({
        try {
            Open-WebPage $script:publishedUrl -UseSelectedBrowser
            $script:controls.Status.Text = 'ブラウザで使えます。メールの確認コードでログインしてください。スマホでも同じ公開URL・同じメールを使います。PWA追加を希望する場合は、公開URLの末尾に install.html を付けて開けます。'
        } catch { $script:controls.Status.Text = $_.Exception.Message }
    })
    $script:controls.Cancel.Add_Click({
        if ($script:job) { $script:job.Cancellation.Cancel(); $script:controls.Cancel.IsEnabled = $false; $script:controls.Status.Text = '中止しています。作成済みの公開先は削除しません。' }
    })
    $script:timer = New-Object Windows.Threading.DispatcherTimer
    $script:timer.Interval = [TimeSpan]::FromMilliseconds(250)
    $script:timer.Add_Tick({
        $item = $null
        while ($script:queue.TryDequeue([ref]$item)) {
            Add-ProgressLine $item.Message
            $script:controls.Status.Text = $item.Message
            switch ($item.Kind) {
                'code' { $script:controls.AuthCode.Text = $item.Value; $script:controls.CodePanel.Visibility = 'Visible' }
                'login' {
                    $script:loggedInUser = $item.Value
                    if ([string]::IsNullOrWhiteSpace($script:controls.Owner.Text)) { $script:controls.Owner.Text = $item.Value }
                    $script:controls.LoginStatus.Text = $item.Message
                    $script:controls.CodePanel.Visibility = 'Collapsed'
                }
                'repository' { $script:repositoryUrl = $item.Value; $script:controls.OpenRepo.IsEnabled = $true }
                'run' { $script:runUrl = $item.Value; $script:controls.OpenRun.IsEnabled = $true }
                'published' { $script:publishedUrl = $item.Value; $script:controls.SiteUrl.Text = $item.Value }
            }
        }
        if ($script:job -and $script:job.Handle.IsCompleted) {
            try { [void]$script:job.Pipeline.EndInvoke($script:job.Handle) }
            catch { Add-ProgressLine $_.Exception.Message; $script:controls.Status.Text = $_.Exception.Message }
            finally { $script:job.Pipeline.Dispose(); $script:job.Cancellation.Dispose(); $script:job = $null; Set-UiBusy $false }
            if ($script:closeAfterWork) { $script:window.Close() }
        }
    })
    $script:window.Add_Closing({
        param($sender, $eventArgs)
        if ($script:job) {
            $answer = [Windows.MessageBox]::Show('処理を中止して閉じますか？作成済みの公開先は削除されません。', '実行中です', 'YesNo', 'Question')
            $eventArgs.Cancel = $true
            if ($answer -eq 'Yes') { $script:closeAfterWork = $true; $script:job.Cancellation.Cancel() }
        }
    })
    $preferencesPath = Join-Path $script:dataRoot 'preferences.json'
    if (-not $SmokeTest -and (Test-Path -LiteralPath $preferencesPath)) {
        try {
            $previous = [IO.File]::ReadAllText($preferencesPath) | ConvertFrom-Json
            Assert-InstallerSettings $previous.Owner $previous.Repository $previous.AppName
            $previousUrl = ConvertTo-InstallerSupabaseUrl $previous.SupabaseUrl
            Assert-InstallerSupabase $previousUrl $previous.SupabaseKey
            foreach ($field in @('Owner','Repository','AppName','SupabaseKey')) { $script:controls[$field].Text = $previous.$field }
            $script:controls.SupabaseUrl.Text = $previousUrl
            $script:controls.Status.Text = '前回の入力を復元しました。自分の接続先を確認し、準備の確認欄をチェックしてから続けてください。'
        } catch { $script:controls.Status.Text = '前回の入力を復元できませんでした。自分の設定を入力してください。' }
    }
    Update-UrlPreview
    if ($SmokeTest) {
        if ($PreviewPath) {
            $view = $script:window.Content
            $view.Background = New-Object Windows.Media.SolidColorBrush([Windows.Media.ColorConverter]::ConvertFromString('#F3F6FB'))
            $view.Measure((New-Object Windows.Size(780, 1450)))
            $view.Arrange((New-Object Windows.Rect(0, 0, 780, 1450)))
            $view.UpdateLayout()
            $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap(780, 1450, 96, 96, ([Windows.Media.PixelFormats]::Pbgra32))
            $bitmap.Render($view)
            $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
            $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
            $previewStream = [IO.File]::Create($PreviewPath)
            try { $encoder.Save($previewStream) } finally { $previewStream.Dispose() }
        }
        Write-Output "GUI loaded and events connected: $($script:controls.Count) controls; no network or repository changes."
        return
    }
    $script:timer.Start()
    [void]$script:window.ShowDialog()
    $script:timer.Stop()
} catch {
    if ($SmokeTest) { Write-Error $_; exit 1 }
    try { [Windows.MessageBox]::Show($_.Exception.Message, 'インストールツールを起動できませんでした', 'OK', 'Error') | Out-Null }
    catch { Write-Error $_ }
    exit 1
}
