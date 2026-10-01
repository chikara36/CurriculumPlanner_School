# 配布・導入メモ

## 推奨配信

静的HTTPSホスティング。サーバーサイド処理は不要です。

必要ファイルは本フォルダにすべて含まれます。Google Drive認証用のGoogle Identity Servicesのみ、Drive同期時にGoogleからオンライン取得します。

## HTTPヘッダー推奨

- `index.html`: `Cache-Control: no-cache`
- `sw.js`: `Cache-Control: no-cache`
- CSS/JS/icons: 通常のキャッシュ可
- HTTPS必須

## 更新

`sw.js` の `CACHE` 名をリリースごとに変更してください。v1.0.0では `curriculum-planner-school-v1.0.0` です。

## Chromebook

管理対象Chromebookの場合、PWAインストール・OAuthアプリ・Drive APIの利用可否はGoogle Admin Consoleの管理設定に依存します。
