# Rikkyo UK Vocab

立教英国学院入試向けの過去問分析型英単語学習Webアプリです。早稲田単語アプリとは、repository・appId・database・localStorage・BroadcastChannel・cache・Service Worker scope・export formatを分離しています。

## Current status

Phase 22 PreviewのUIと機能構成はそのままに、Phase 17の正式なCore 241データと623 stable-ID Registryを接続しています。UIや学習機能の追加変更は行わず、データ接続だけを反映しています。

Core 241は `public/data/` に配置し、runtime adapterが241/241の整合性を確認してから読み込みます。stable IDは再発行しません。

## Commands

```bash
pnpm install
pnpm run check
pnpm run dev
```

GitHub Pagesのbase pathは `/rikkyo-uk-vocab/` です。`main`へのpushまたは手動実行でworkflowがbuild/test後にPages artifactをdeployします。

## Frozen scheduler settings

- FSRS-6
- `ts-fsrs` 5.4.2 exact pin
- desired retention 0.90
- fuzz off
- short-term FSRS off
