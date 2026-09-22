# Waseda complete application transplant (Rikkyo 4.0.0)

Baseline: FYam8/english-vocab commit `6f4788386a1935d6e2703c694257c1f327b0f831`.
Only the Rikkyo repository is changed. No executable code is hotlinked from Waseda.

## Running application

`vendor/waseda` contains all original runtime modules and the complete HTML shell.
`waseda-app.lock.json` records their upstream revision and byte hashes. CI compares
all 16 files directly against that revision. `tools/prepare-coach.mjs` assembles
these modules in the original order with Rikkyo's corpus. The original question
selection, distractors, grading, objective mastery, retry queue, memory curve,
feedback, example renderer, list, statistics, analysis, settings and navigation
are the running implementation, rather than separate TypeScript reimplementations.

The 7.6 memory model uses `.9 ** (elapsedDays / stabilityDays)`. Its policy targets
90–93% retention depending on importance and weakness. Misses are scheduled for
15 minutes; a correct same-session retry for one day. Subsequent intervals follow
the original stability/difficulty update. New words start with four choices;
reverse choices, typing, cloze and audio become eligible with mastery.

The earlier Rikkyo FSRS and UI source remains for legacy backup compatibility and
historical tests only. `src/coach/bootstrap.js` is the sole Vite entry point.
It does not import the old planner or UI. `src/config.ts` deliberately retains the
v3 format constants required to validate existing exports; current product and
export metadata are in `public/release-manifest.json` and the coach host.

## Narrow school and device adaptations

- Rikkyo name, 2024–2026 corpus, Foundation/Core/Challenge membership, priorities,
  frequencies and stable IDs. All 241 items have an example and full Japanese
  translation; 132 use source-matched excerpts, 109 clearly labelled practice
  examples. Translations of source excerpts are in `source-translations.json`.
- The ten category labels requested by the user remain. Foundation/Core/Challenge
  map to the upstream 60/70/75 pools. The retained exam category uses the upstream
  default normal-learning pool; it does not introduce a second scheduler.
- Rikkyo currently supplies no diagnostic/reference-layer items. Explanatory text
  does not falsely claim that its dataset has Waseda's four populated layers.
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
memory, mastery, next-review dates, question types and scheduler scores, plus UI
answers, translated feedback, resume without double scoring, finite/unlimited
sessions, legacy migration, retired history, imports, backups and Waseda-key
isolation. Local and production browser checks each run twice.
