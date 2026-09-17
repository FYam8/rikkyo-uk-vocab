# 立教英国 Vocabulary Coach

立教英国学院入試向けの過去問分析型英単語学習Webアプリです。早稲田単語アプリとは別repositoryとして運用しています。

## 公開版

FY24〜FY26の英語6冊を再監査し、本文注釈語・定型指示・初歩語の過大評価を除いて再選定したCore 241をGitHub Pagesへ自動公開します。

- Core release: **241 entities**
- Stable-ID Registry: **912 IDs**（旧801 IDをすべて保持）
- Data version: **0.24.0-lexical**
- Difficulty bands: **Foundation 30 / Core 151 / Challenge 60**
- Difficulty policy: 得点層ではなく語彙そのものの難度で区分し、過去問テーマから転移語彙を補充
- Scheduler: **FSRS-6 / ts-fsrs 5.4.2 / desired retention 0.90 / fuzz off / short-term FSRS off**
- Memory key: **stableId × skillKey**
- Learning lanes: **learning / relearning / provisional / review / acquisition**
- Initial diagnostic: **maximum 24 questions**
- Storage: **IndexedDB + Single Writer fencing**
- Recovery: **Export / Import / Browser Backup / Restore / Reset generation**
- Session: **questionInstanceId duplicate-grade protection + resumable session state**

公開URL: https://fyam8.github.io/rikkyo-uk-vocab/

## 公開境界

公開artifactには学習に必要な公開可能フィールドだけを含めます。過去問PDF、raw evidence、source-derived example textは含めません。stable IDは再発行しません。

## Release checks

Pages workflowは公開前に次を検証します。

- 241 / 241 Core entity
- 912 / 912 stable-ID Registry（旧IDの削除・再利用なし）
- TypeScript production build
- automated tests
- adaptive queue / short-term learning / diagnostic policy

現在の公開版はPhase 22 Core 241 adaptive buildです。
