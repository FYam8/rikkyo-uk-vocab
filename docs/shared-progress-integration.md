# Rikkyo shared Cloud progress

Production Source of Truth: FYam8/waseshibu-progress-cloud@25c111ed4fc4dcd76b9af5053d6039698271e340, immutable tag progress-prod-20261003-25c111e. The exact common transport is pinned in shared-progress-production.json and hash-checked by CI.

School: rikkyo-uk. Endpoint: https://rikkyo-uk-progress-api.fyam8.workers.dev. Shared browser database: rikkyo-uk-progress-sync, version 7. Each subject retains its existing local learning storage and reads it only for summary projection. No raw answers, source texts, backups or complete learning stores are uploaded.

All four subjects recognize the legacy rikkyo-uk-kokugo-progress-sync database. Credentials move only with an exact verified school/endpoint scope. Unverified endpoints and registration conflicts block Cloud traffic and display a notice; both databases remain intact. Migration markers are written after destination readback. Registration, pending seed, queued revisions and seen records are preserved by the upstream transport.

Reset/import/export affect local learning only; shared Cloud identity is neither reset nor exported. Local development has Cloud disabled unless an explicit test endpoint is supplied. Kokugo additionally requires VITE_PROGRESS_API_BASE or its explicit runtime override. Browser QA uses disposable profiles and intercepts production Cloud calls.

The progress projection distinguishes learning time from sync time, FY24A/B through FY26A/B, and the actual subject holdout policy. Non-authoritative scores appear only as reference accuracy. Vocab projections use the existing mastery and last-result fields; no scheduler, memory algorithm, stable ID or mastery writes are added.

Rollback: deploy the previous verified application commit while retaining both Cloud databases. Do not delete registrations or namespaces. Cloud rollback must retain the Rikkyo namespace and use its own prior Worker version; never point to Waseda's namespace or credential audience.
