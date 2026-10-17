# Waseda complete application transplant (Rikkyo 4.3.0)

Baseline: FYam8/english-vocab commit `6f4788386a1935d6e2703c694257c1f327b0f831`.
Only the Rikkyo repository is changed. No executable code is hotlinked from Waseda.

## Running application

`vendor/waseda` contains all original runtime modules and the complete HTML shell.
`waseda-app.lock.json` records their upstream revision and byte hashes. CI compares
all 16 files directly against that revision. `tools/prepare-coach.mjs` assembles
these modules in the original order with Rikkyo's corpus. The original question
selection, distractors, grading, retry queue, memory curve,
feedback, list, statistics, analysis, settings and navigation
are the running implementation, rather than separate TypeScript reimplementations.

The 7.6 memory model uses `.9 ** (elapsedDays / stabilityDays)`. Its policy targets
90–93% retention depending on importance and weakness. Misses are scheduled for
15 minutes; a correct short retry schedules a check one day later. The additive
`src/common-engine/delayed-retention.js` policy controls positive mastery and
stability gains as described below. Errors retain the original penalties. New words start with four choices;
reverse choices, typing, cloze and audio become eligible with mastery.

The earlier Rikkyo FSRS and UI source remains for legacy backup compatibility and
historical tests only. `src/coach/bootstrap.js` is the sole Vite entry point.
It does not import the old planner or UI. `src/config.ts` deliberately retains the
v3 format constants required to validate existing exports; current product and
export metadata are in `public/release-manifest.json` and the coach host.

## Narrow school and device adaptations

- Rikkyo name, 2024–2026 corpus, Foundation/Core/Challenge membership, priorities,
  frequencies and stable IDs. All 426 items have bilingual examples: 309 printed
  targets plus 5 inferred grammar targets use reviewed original excerpts/tasks;
  112 extension entries have clearly labelled generated practice examples. The
  school feedback renderer preserves `tools/data/original-excerpts.tsv` verbatim
  and identifies gaps, rearrangement, error-correction tasks and PDF references.
- The ten ordinary categories remain and an explicit optional category is added. Foundation/Core/Challenge
  map to the upstream 60/70/75 pools. The retained exam category uses the upstream
  default normal-learning pool; it does not introduce a second scheduler.
- All 117 zero-frequency entries use the reference layer, excluded by upstream
  ordinary planners and distractors. A school filter supplies them only to the
  explicit optional mode; scheduling and memory calculations remain upstream.
  Session validation permits reference targets only for that opt-in mode.
- Audio can be disabled or replaced by text if the device cannot play speech.
- Storage and backups use only Rikkyo namespaces. Extra settings expose old and
  new device backups. Waseda localStorage keys are never read or written.

## Learning history

The original IndexedDB v3 records are kept. On first launch their verified export
is archived before conversion. Existing stable IDs, historical correct/wrong
counts, recent outcomes, timestamps and due dates are carried into Waseda state.
Retired word records remain in the archive and state. The original Waseda legacy
memory initializer uses retained dates on the next answer. We do not pretend an
FSRS internal state is the same mathematical model as Waseda's stability model.

An active v3 session is converted with its question/session IDs, answer count and
remaining queue. New state and session use one versioned Rikkyo localStorage
bundle. Exports include the complete archived v3 envelopes. Both v3 and v4 imports
are checksum-validated. Concurrent tabs reload rather than overwrite a newer
bundle revision. Malformed stored state blocks loading without resetting it.

## Repetition and verification

Finite base questions are selected without replacement. Retry spacing and the
one-retry limit are exactly upstream. Across sessions, due dates are part of the
upstream weighting; they are not an absolute exclusion. Rikkyo's former custom
24-hour exclusion is no longer active. Consequently this release does not claim
that previously answered words can never reappear before their review date.

Browser QA compares 64 actual outcome transitions against separately evaluated
original Waseda code with the same corpus, clock and random values. It checks
memory, mastery, next-review dates, question types and scheduler scores under the
same additive delayed-retention policy, plus UI
answers, translated feedback, resume without double scoring, finite/unlimited
sessions, legacy migration, retired history, imports, backups and Waseda-key
isolation. Local and production browser checks each run twice.

## Delayed retention policy (v4.3.0)

The pinned upstream files remain byte-identical. The build loads the reusable
`src/common-engine/delayed-retention.js` after them, before the school adapter.
Only this additional learning policy differs from the upstream baseline.

- An initial correct answer records the normal evidence and stays at learning.
- A correct answer less than 24 elapsed hours after the latest exposure is
  practice: counts and recent outcomes are retained, but evidence, mastery,
  stability and difficulty do not improve. This applies across sessions too.
- Correct recovery after an error schedules a check 24 hours later. More short
  practice preserves that deadline. Existing longer intervals are preserved.
- A correct answer at least 24 hours after the latest exposure contributes twice
  the normal evidence. Each such recall permits one further mastery stage,
  subject to the existing evidence thresholds. Strong production formats still
  count more than choices. Delayed recalls use the original stability growth.
- A miss retains the original penalty and 15-minute deadline, and resets the
  count of successful delayed recalls since the most recent miss.
- Existing mastery is not retroactively reduced on upgrade. The optional
  `retentionEvidence` field is written only on the next scored answer. Schema 7,
  IDs, answer counters, due dates and old exports remain compatible. Its count
  and timestamp survive reloads and v4 export/import.

The 24-hour boundary is an explicit product rule, not a claim of a uniquely
optimal scientific interval. Calendar midnight alone does not qualify. A short
practice resets the exposure clock. Retry insertion still uses the upstream
6/8-question gap and one retry per session; no new cross-session exclusion is
introduced. Hooks adjust the result inside the original transaction, before
its save and before session mastery notifications.

Regression coverage runs the actual pinned runtime with this policy, including
short practice, new sessions, missed retries, exact 24-hour boundaries, several
delayed days, old state, persisted saves and restored backups. Browser checks
also verify the assembled release and its service-worker cache.
