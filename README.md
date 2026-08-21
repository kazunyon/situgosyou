# ことばメモ

失語症のある方が、思い出したい「ことば」や説明を、必要なときにすぐ確認するための個人用PWAです。

各項目には編集可能な分類番号を付けられ、`すべて`とは別に番号ごとの一覧へ切り替えられます。タイトルと意味・説明を、文字入力または音声入力で登録でき、大切なメモには星マークを付けられます。Supabaseを設定すると、同じメールアドレスでログインしたPCとスマートフォンで、同じメモを利用できます。

公開先：<https://kazunyon.github.io/situgosyou/>

## 主な機能

- メモの登録・編集・削除
- 各メモへの編集可能な分類番号の設定と、番号ごとの表示切り替え
- タイトルと意味・説明の検索
- 大切なメモへの星マーク
- 日本語の音声入力（対応ブラウザのみ）
- Supabaseを使ったPC・スマートフォン間の同期
- メールのMagic Linkによるパスワード不要ログイン
- JSONファイルへのバックアップと復元
- ホーム画面へ追加できるPWA
- RLS（行レベルセキュリティ）による利用者ごとのデータ分離

## データの保存場所

Supabaseの設定の有無によって、保存場所が変わります。

| 動作モード | 保存場所 | PC・スマホ同期 | ログイン |
| --- | --- | --- | --- |
| 端末内の試作モード | ブラウザの`localStorage` | できません | 不要 |
| Supabase同期モード | SupabaseのPostgreSQL | できます | 必要 |

画面に「いまはこの端末だけの試作モードです」と表示される場合は、Supabaseがまだ設定されていません。

端末内の試作モードで作成したメモは、Supabase設定後に自動転送されません。残したいメモがある場合は、設定前に **設定 → バックアップ** でJSONファイルへ保存し、Supabaseへログインした後に **バックアップを戻す** を実行してください。

```mermaid
flowchart TD
    PC[PCのブラウザ] --> AUTH[Supabase Auth]
    PHONE[スマートフォン] --> AUTH
    AUTH --> DB[(Supabase PostgreSQL)]
    DB --> RLS[RLSで本人のメモだけ許可]
```

## 最初に用意するもの

- Git
- Node.js 20系とnpm
- GitHubアカウント
- Supabaseアカウント
- Magic Linkを受信できるメールアドレス

## 1. ソースコードをPCへ取得する

PowerShellを開き、次を実行します。

```powershell
cd C:\home\github
git clone https://github.com/kazunyon/situgosyou.git
cd situgosyou
npm install
```

すでに取得済みの場合は、次のように最新化します。

```powershell
cd C:\home\github\situgosyou
git pull origin main
npm install
```

## 2. Supabaseプロジェクトを作成する

Supabaseは、メモを保存するPostgreSQL、ログイン機能、Webアプリから利用するAPIをまとめて提供します。このアプリでは、SupabaseをPC・スマートフォン共通の保存先として使用します。

1. [Supabase](https://supabase.com/)を開き、ログインします。
2. Dashboardで **New project** を選びます。
3. 次の内容を入力します。

| 項目 | 設定例 | 説明 |
| --- | --- | --- |
| Organization | `situgosyou Org` | プロジェクトを管理する入れ物です。既存Organizationでも構いません。 |
| Project name | `situgosyou` | Supabase上のプロジェクト名です。 |
| Database Password | 自動生成した強いパスワード | GitHubやREADMEへ書かず、安全な場所へ保管します。 |
| Region | 日本に近いリージョン | 選択肢に東京があれば東京を選びます。 |
| Pricing Plan | Freeなど | 利用目的に合うプランを選びます。 |

4. **Create new project** を押します。
5. データベースの準備が完了し、プロジェクト画面が開くまで待ちます。

Database Passwordは、このWebアプリの環境変数には設定しません。ただし、将来データベースへ直接接続するときに必要になるため、紛失しないよう保管してください。

## 3. メモ用テーブルとRLSを作成する

リポジトリの [`supabase/schema.sql`](supabase/schema.sql) をSupabaseのSQL Editorで実行します。

1. Supabase Dashboardで対象プロジェクトを開きます。
2. 左側の **SQL Editor** を開きます。
3. **New query** を選びます。
4. [`supabase/schema.sql`](supabase/schema.sql) の内容をすべてコピーし、SQL Editorへ貼り付けます。
5. **Run** を押します。
6. 左側の **Table Editor** を開き、`public.memos`テーブルがあることを確認します。

このSQLは、次の内容を設定します。

- `memos`テーブルの作成
- 利用者を識別する`user_id`の保存
- RLS（行レベルセキュリティ）の有効化
- 参照・登録・更新・削除を本人のメモだけに制限するポリシー
- メモ一覧を効率よく表示するためのインデックス

RLSは重要です。ブラウザで利用するキーが分かっても、ログイン中の利用者は`memos.user_id = auth.uid()`に一致する自分のメモだけを操作できます。

### すでにSupabaseを利用している場合

分類番号機能を追加するため、アプリを公開する前に次の作業を1回だけ行います。既存のメモは削除されません。

1. Supabase Dashboardで対象プロジェクトを開きます。
2. 左側の **SQL Editor** で **New query** を選びます。
3. [`supabase/migrations/20260822000000_add_display_number.sql`](supabase/migrations/20260822000000_add_display_number.sql) の内容をすべてコピーして貼り付けます。
4. **Run** を押します。
5. エラーが表示されなければ完了です。既存のメモには`1、2、3…`の分類番号が設定され、あとから自由に変更できます。

## 4. Magic LinkログインのURLを設定する

このアプリは、パスワードの代わりにメールで届くMagic Linkを使います。SupabaseではEmailログインとMagic Linkが通常は最初から有効ですが、次の設定を確認してください。

1. Supabase Dashboardで **Authentication** を開きます。
2. **Providers** または **Sign In / Providers** で **Email** が有効になっていることを確認します。
3. **URL Configuration** を開きます。
4. **Site URL** に次を登録します。

```text
https://kazunyon.github.io/situgosyou/
```

5. **Redirect URLs** に次の2件を追加します。

```text
http://localhost:5173/
https://kazunyon.github.io/situgosyou/
```

6. 設定を保存します。

URL末尾の`/`も含めて登録してください。ここに登録されていないURLへは、Magic Linkでログイン後に戻れません。

## 5. Project URLとPublishable keyを取得する

1. Supabase Dashboardで対象プロジェクトを開きます。
2. 画面上部の **Connect** を開きます。見つからない場合は **Settings → API Keys** を開きます。
3. 次の2つを控えます。

| 必要な値 | 形式の例 | 用途 |
| --- | --- | --- |
| Project URL | `https://xxxxxxxx.supabase.co` | 接続先のSupabaseプロジェクト |
| Publishable key | `sb_publishable_...` | ブラウザからSupabaseへ接続する公開用キー |

このリポジトリでは互換性のため環境変数名が`VITE_SUPABASE_ANON_KEY`になっていますが、値には現在推奨されている **Publishable key** を設定できます。

> `service_role`キーや`sb_secret_...`で始まるSecret keyは、絶対に設定しないでください。これらはRLSを回避できるサーバー専用の秘密情報で、ブラウザやGitHub Pagesへ公開してはいけません。

## 6. PCの開発環境へSupabaseを設定する

プロジェクトのルートで、`.env.example`を`.env.local`へコピーします。

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

`.env.local`を次のように編集します。

```dotenv
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxx
```

設定後、開発サーバーを起動します。

```powershell
npm run dev
```

ブラウザで次を開きます。

<http://localhost:5173/>

`.env.local`は`.gitignore`に登録されています。秘密情報ではないPublishable keyであっても、環境ごとの設定ファイルとしてGitHubへコミットしないでください。

## 7. PCでログインして動作を確認する

1. 画面の **PCとスマホで同期** にメールアドレスを入力します。
2. **ログイン** を押します。
3. 受信したメールを、ログインしたいPCで開きます。
4. メール内のMagic Linkを押します。
5. 「メールアドレス で同期中」と表示されることを確認します。
6. **新しく書く** から確認用のメモを1件保存します。
7. Supabase Dashboardの **Table Editor → memos** に、保存した行が追加されたことを確認します。

メールが届かない場合は、迷惑メールフォルダーも確認してください。Magic Linkは一度だけ使用できます。

## 8. GitHub Pagesへ公開する

このリポジトリには、GitHub Pagesへ自動公開するGitHub Actions workflowが含まれています。

### 8-1. GitHub Pagesの公開方法を設定する

1. GitHubで`kazunyon/situgosyou`を開きます。
2. **Settings → Pages** を開きます。
3. **Build and deployment → Source** で **GitHub Actions** を選びます。

### 8-2. Supabaseの値をGitHub Actionsへ登録する

現在のworkflowはGitHub Actionsの **Secrets** を読み込みます。**Variablesではありません。**

1. **Settings → Secrets and variables → Actions** を開きます。
2. **Secrets** タブを選びます。
3. **New repository secret** を押し、次の2件を登録します。

| Secret名 | 設定する値 |
| --- | --- |
| `VITE_SUPABASE_URL` | SupabaseのProject URL |
| `VITE_SUPABASE_ANON_KEY` | SupabaseのPublishable key |

4. `main`ブランチへ変更を反映すると、workflowが自動でビルドと公開を行います。
5. GitHubの **Actions** タブで、**Deploy to GitHub Pages** が緑色のチェックになったことを確認します。
6. <https://kazunyon.github.io/situgosyou/> を開きます。

Secretを変更しただけでは、すでに公開済みの画面は自動で再ビルドされない場合があります。その場合は、**Actions → Deploy to GitHub Pages → Run workflow** から再実行してください。

## 9. PCとスマートフォンを同期する

PCとスマートフォンでは、必ず同じメールアドレスでログインします。

### PC側

1. <https://kazunyon.github.io/situgosyou/> をPCで開きます。
2. 同期に使うメールアドレスを入力します。
3. PCで受信メールを開き、Magic Linkを押します。
4. メモを1件保存します。

### スマートフォン側

1. 同じ公開URLをスマートフォンで開きます。
2. PCと同じメールアドレスを入力します。
3. スマートフォンで受信メールを開き、Magic Linkを押します。
4. PCで作成したメモが表示されることを確認します。
5. スマートフォンでメモを追加し、PCでも確認します。

Magic Linkは、ログインしたい端末で開くのが分かりやすい方法です。PCとスマートフォンの両方をログイン状態にするには、それぞれの端末でMagic Linkログインを行います。

このアプリは、起動時・ログイン時にSupabaseから最新のメモを読み込みます。片方の端末ですでに画面を開いたまま、もう片方で変更した場合は、開いている側の画面を再読み込みするか、アプリをいったん閉じて開き直してください。

## 10. スマートフォンのホーム画面へ追加する

### iPhone・iPad（Safari）

1. Safariで<https://kazunyon.github.io/situgosyou/>を開きます。
2. 共有ボタンを押します。
3. **ホーム画面に追加** を選びます。
4. **追加** を押します。

### Android（Chrome）

1. Chromeで公開URLを開きます。
2. 右上のメニューを開きます。
3. **アプリをインストール** または **ホーム画面に追加** を選びます。
4. 画面の案内に従います。

## バックアップと復元

画面右上の設定から利用できます。

- **バックアップ**：現在のメモをJSONファイルへ保存します。
- **バックアップを戻す**：JSONファイルの内容で、現在のメモを置き換えます。

Supabase同期モードではログイン後に利用できます。復元は現在のメモを置き換えるため、実行前に確認画面の件数を確認してください。

## セキュリティ

- `public.memos`ではRLSを有効にしています。
- 各行の`user_id`とログイン利用者の`auth.uid()`が一致する場合だけ操作できます。
- Publishable keyはブラウザ用ですが、RLSとセットで使用することが前提です。
- `service_role`キー、Secret key、Database PasswordはGitHubへ保存しません。
- `.env.local`はGitの管理対象外です。

## データ項目

| 画面上の項目 | DB列 | 内容 |
| --- | --- | --- |
| ID | `id uuid` | メモを一意に識別します。 |
| 利用者 | `user_id uuid` | Supabase Authの利用者IDです。 |
| 分類番号 | `display_number integer` | `すべて`とは別に一覧を切り替えるための1〜9999の番号です。 |
| タイトル | `title varchar(255)` | 必須項目です。 |
| 意味・説明 | `meaning varchar(2000)` | 思い出すための説明です。 |
| マーク | `marked char(1)` | `★`または空文字です。 |
| 削除フラグ | `deleted boolean` | 画面から削除した状態を管理します。 |
| 作成日時 | `created_at timestamptz` | 作成した日時です。 |
| 更新日時 | `updated_at timestamptz` | 最後に変更した日時です。 |

## よくある問題

| 症状 | 確認すること |
| --- | --- |
| 「この端末だけの試作モード」と表示される | PCでは`.env.local`、GitHub PagesではActions Secretsの2項目を確認し、再ビルドします。 |
| Magic Linkのメールが届かない | メールアドレス、迷惑メール、SupabaseのEmail Provider、短時間の連続送信制限を確認します。 |
| Magic Linkを押してもログインできない | SupabaseのSite URLとRedirect URLsを確認します。公開URLとローカルURLは末尾の`/`まで合わせます。 |
| PCとスマートフォンで違うメモが表示される | 両方が同じメールアドレスでログイン中か確認します。片方を再読み込みします。 |
| GitHub Pagesへ設定が反映されない | Actions Secretsの名前を確認し、Deploy workflowを再実行します。 |
| `memos`が見つからない | SupabaseのSQL Editorで`supabase/schema.sql`を最後まで実行したか確認します。 |
| 保存時に権限エラーになる | ログイン状態、`memos`のRLS有効化、4つのRLSポリシーを確認します。Data APIの公開設定を変更している場合は`public`スキーマの設定も確認します。 |
| スマートフォンで古い画面が出る | PWAを閉じて開き直すか、ブラウザで再読み込みします。 |

## 開発用コマンド

| コマンド | 内容 |
| --- | --- |
| `npm install` | 必要なパッケージをインストールします。 |
| `npm run dev` | 開発サーバーを起動します。 |
| `npm run build` | TypeScriptの確認と本番ビルドを行います。 |
| `npm run preview` | ビルド結果をローカルで確認します。 |

## 技術構成

- React 18
- TypeScript 5.6
- Vite 5
- vite-plugin-pwa
- Supabase JavaScript Client 2
- Supabase Auth
- Supabase PostgreSQL
- GitHub Pages
- GitHub Actions
