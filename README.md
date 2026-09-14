# Rikkyo UK Vocab

立教英国学院入試向けの過去問分析型英単語学習Webアプリです。早稲田単語アプリとは、repository・appId・database・localStorage・BroadcastChannel・cache・Service Worker scope・export formatを分離しています。

## Current status

Phase 22 Previewです。UI / Storage / deploy基盤を公開できますが、Phase 17の正式な `manifest`、623 stable-ID Registry、Core 241 app-dataはこのrepositoryにまだ接続されていません。その間はData Gateが実学習開始を停止します。架空の教材データは入れません。

Productionへ進む前に、正式bundleを `public/data/runtime-bundle.json` として接続し、Capability Adapter mappingが241/241になる必要があります。stable IDは再発行しません。

## Commands

```bash
pnpm install
pnpm run check
pnpm run dev
```

GitHub Pagesのbase pathは `/rikkyo-uk-vocab/` です。`main`へのpushまたは手動実行でPreview workflowがbuild/test後にPages artifactをdeployします。

## Frozen scheduler settings

- FSRS-6
- `ts-fsrs` 5.4.2 exact pin
- desired retention 0.90
- fuzz off
- short-term FSRS off
