# Rikkyo Vocabulary enrichment provenance

The enrichment layer is derived from the six supplied Rikkyo UK English papers:

- FY24 A/B
- FY25 A/B
- FY26 A/B

The original 623 IDs and all Phase 23 additions remain immutable. Phase 24 adds deterministic IDs for lexical-difficulty and Rikkyo-theme transfer items, expanding the registry to 912; no old ID is deleted or reused. The active set remains 241 items so retired learning history survives independently of the current queue.

`tools/build-enrichment.mjs` matches each Core lemma and common inflections against page-scoped OCR. It records only compact evidence metadata and one learner-facing source example. OCR matches are labelled as past-paper evidence. Where an exact usable example was not recovered, the generator uses a short, explicitly labelled original example based on the observed Rikkyo task patterns.

The app must never present generated text as a verbatim past-paper quotation. Source examples show year, schedule, and PDF page. Generated examples show the `generated` label.
