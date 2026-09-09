# Design QA: 同期中アイコン

- source visual truth: conversation attachment `codex-clipboard-56d69864-b436-49d6-bc74-4674be3fcb37.png`
- implementation screenshot: external QA artifact `sync-indicator-after.jpg`
- viewport: reference-width desktop `741 x 1000`、mobile `390 x 844`
- source pixels: `741 x 1207`
- implementation pixels: desktop `741 x 1000`、mobile `390 x 844`
- CSS size / density normalization: アプリ本体は最大幅 `680px`。ブラウザ枠を除いたヘッダー領域を同じ表示倍率で比較し、密度変換は行っていない。
- state: 同期済みユーザー（表示確認用に同期状態を一時的に再現。確認後、再現コードは削除済み）

## Full-view comparison evidence

参照画像と実装後の全画面キャプチャを同じ会話コンテキストで確認した。既存のロゴ、見出し、検索、主要操作、カテゴリ領域、下部ナビゲーションの構成は維持されている。参照画像は登録済みデータ、ローカル確認画面は空状態のため本文内容は異なるが、今回の比較対象であるヘッダー構造には影響しない。

## Focused region comparison evidence

ヘッダー右上を重点比較した。参照画像で赤丸指定された設定ボタン左の空き領域に、`40 x 40px`、角丸 `12px` の同期アイコンを配置した。設定ボタンと高さをそろえ、間隔は `8px`。既存のコーラル色と淡い背景色を再利用している。スマートフォン幅でもロゴや設定ボタンとの重なり、切れ、横スクロールは発生していない。

## Required fidelity surfaces

- Fonts and typography: 既存フォント、文字サイズ、見出し階層に変更なし。
- Spacing and layout rhythm: 設定ボタンと同期アイコンを同一アクショングループにまとめ、既存ヘッダーの高さを維持。
- Colors and visual tokens: 既存の `#d55848` と `#fff0ed` を使用。
- Image quality and asset fidelity: 既存依存関係の Lucide `Cloud` アイコンを使用。拡大時にも劣化しないベクター表示。
- Copy and content: 表示上はアイコンのみ。読み上げ名とツールチップに「{メールアドレス} で同期中」を設定。

## Findings

P0 / P1 / P2 の未解決事項なし。

## Comparison history

1. Earlier finding: 同期中でもヘッダーに状態表示がなく、設定ボタン左が空いていた。
2. Fix: 同期済みユーザーに限ってクラウドアイコンを表示し、メールアドレスを読み上げ名とツールチップに含めた。
3. Post-fix evidence: desktop と mobile の両方でアイコン表示、未ログイン状態での非表示、設定ボタン操作、ブラウザの error / warn なしを確認。

## Follow-up polish

なし。

final result: passed
