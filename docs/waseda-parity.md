# Waseda baseline (3.7.0)

Source: FYam8/english-vocab at `6f4788386a1935d6e2703c694257c1f327b0f831`.
This release changes only the Rikkyo repository. It does not hotlink executable
code or storage from the Waseda site.

## Reused source

- The complete Waseda shell stylesheet, extracted without changes from
  `00-shell-prefix.html`, controls colors, typography, cards, responsive answer
  layout, navigation, and sheets.
- The actual Waseda `session-orchestration.js` builds acquisition plans; its
  `weightedChoice` and `v75WeightedWithoutReplacement` functions select words.
  Only ESM exports are appended to these vendored JavaScript files.
- The existing Waseda progress runtime remains shared.
- CI compares the vendored artifacts with the pinned upstream source, in
  addition to local hashes. Updating a hash alone cannot satisfy this gate.

## School-specific data

Keep identity in `school-config.ts`; corpus, source evidence, years, priority,
and Foundation/Core/Challenge membership remain in the dataset. A/B are source
metadata, not separate learning pools. Rikkyo uses its own storage namespace.
The daily goal is informational and never disables a mode that has eligible words.

## Compatibility adapters (not yet identical source)

The TypeScript renderers use Waseda's visual primitives and learning flow, but
are not the same renderer functions as Waseda's global JavaScript application.
The existing Rikkyo IndexedDB schema, event log, stable IDs, import/export,
diagnostic, and FSRS skill records are retained to preserve learning history.
Waseda's storage format and scheduler are not substituted for those records.
The Rikkyo “できるだけ” option is a finite batch, not Waseda's unlimited session.
These compatibility differences must not be described as full UI/UX sharing.

## Repeat handling

A word's latest answer protects both recognition and production: 24 hours
after a correct answer, 10 minutes after a miss. Legacy short due dates do not
bypass this guard. Relearning graduation schedules a future review rather than
restoring an expired date. A wrong base question may receive one retry after
6 or 8 intervening answers. If that gap cannot be met, it stays scheduled for
later study instead of repeating immediately at session end. Unanswered legacy
retries receive the same spacing check on resume. No answer history is erased.

Starting another session no longer replays a fixed daily opening order. Leaving
the learning screen preserves the active session; returning offers continue or
finish instead of silently replacing it.
