# 立教英国 Vocabulary Coach

立教英国学院入試向けの過去問分析型英単語学習Webアプリです。早稲田単語アプリとは別repositoryとして運用しています。

## 公開版

Core 241の正式Phase 17データを接続した学習版をGitHub Pagesへ自動公開します。

- Core release: **241 entities**
- Stable-ID Registry: **623 IDs**
- Data version: **0.22.1-core**
- Question drafts: **476**
- Scheduler: **FSRS-6 / ts-fsrs 5.4.2 / desired retention 0.90 / fuzz off / short-term FSRS off**

公開URL: https://fyam8.github.io/rikkyo-uk-vocab/

## 公開境界

公開artifactには学習に必要な公開可能フィールドだけを含めます。過去問PDF、raw evidence、source-derived example textは含めません。stable IDは再発行しません。

## Release artifact

Pages workflowは `releases/rikkyo-uk-vocab-dist-core241-ready.zip` を展開し、次を検証した上で公開します。

- 241 / 241 Core entity
- 623 / 623 stable-ID Registry
- 241 study presentations
- 476 question drafts
- source-derived example / raw evidence leakageなし

現在の公開版はPhase 22 Core 241 ready buildです。
