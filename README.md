# ことばメモ

失語症のある方が、思い出したいことをすぐに開いて確認するためのPWAです。タイトルと意味を文字または音声で書き、重要なものにはマークを付けられます。

## PC・スマホの同期を有効にする

1. [Supabase](https://supabase.com/)でプロジェクトを作成し、`supabase/schema.sql`をSQL Editorで実行します。
2. AuthenticationでEmailのMagic Linkを有効にします。Redirect URLに実際の公開URLと、開発時は `http://localhost:5173` を登録します。
3. `.env.example` をコピーして `.env.local` にし、Project URLとanon keyを設定します。
4. `npm install` の後、`npm run dev` で起動します。

## GitHub Pages で公開する

このリポジトリには GitHub Pages 用の Actions workflow が含まれています。最初に GitHub のリポジトリ画面で **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に変更してください。

次に **Settings → Secrets and variables → Actions → Variables** に、次の 2 つを登録します。

- `VITE_SUPABASE_URL`: Supabase の Project URL
- `VITE_SUPABASE_ANON_KEY`: Supabase の anon public key

`main` ブランチへ workflow を含む変更を push すると、自動で `https://kazunyon.github.io/situgosyou/` に公開されます。Supabase Authentication の Redirect URL にも、この URL を追加してください。

RLS（行レベルセキュリティ）により、`memos.user_id = auth.uid()` の条件をデータベース側で必ず検査します。同じ端末でも、AさんのログインでBさんのデータを読む・更新することはできません。

## データ項目

| 項目 | DB列 |
| --- | --- |
| タイトル | `title varchar(255)` |
| 意味 | `meaning varchar(2000)` |
| マーク | `marked char(1)`（`★` または空） |
| 削除フラグ | `deleted boolean` |

`user_id`、作成日時、更新日時は同期と利用者分離のために追加しています。
