/* Additive policy for the pinned Vocabulary Coach runtime. No school data. */
const WASEDA_DELAYED_RETENTION_POLICY = Object.freeze({
  version: 1,
  minimumGapMs: 86400000,
  classify(progress, at) {
    if (!attemptCount(progress)) return 'initial';
    const last = Date.parse(progress.lastStudied || progress.memoryModel?.lastReviewAt || '');
    return Number.isFinite(last) && at - last >= this.minimumGapMs ? 'delayed' : 'practice';
  },
});

// Hooks run inside the upstream outcome transaction, before its single save.
// Other uses of recordObjectiveResult (including legacy conversion) are intact.
(() => {
  let active = null;
  const apply = v75ApplyMainOutcome;
  const record = recordObjectiveResult;
  const update = v76UpdateMemoryAfterOutcome;

  v75ApplyMainOutcome = function(v, pending) {
    const p = getProgress(v.id), prior = active;
    const kind = WASEDA_DELAYED_RETENTION_POLICY.classify(p, now());
    active = {
      p, kind, evidence: Number(p.evidence) || 0, mastery: p.mastery,
      nextReview: p.nextReview, lastRating: p.lastRating, recentMistakeUntil: p.recentMistakeUntil,
      retention: {...(p.retentionEvidence || {version: 1, confirmations: 0, lastConfirmedAt: null})},
    };
    try { return apply(v, pending); } finally { active = prior; }
  };

  recordObjectiveResult = function(p, ok, type) {
    record(p, ok, type);
    if (!active || active.p !== p) return;
    const a = active;
    p.retentionEvidence = {...a.retention, version: 1};
    const result = p.recentResults.at(-1);
    result.retentionKind = a.kind;
    if (!ok) {
      p.retentionEvidence.confirmations = 0;
      return; // Preserve the original error penalty and lapse handling.
    }
    if (a.kind === 'practice') {
      p.evidence = a.evidence;
      p.mastery = a.mastery;
    } else {
      if (a.kind === 'delayed') {
        p.retentionEvidence.confirmations = Math.max(0, Number(a.retention.confirmations) || 0) + 1;
        p.retentionEvidence.lastConfirmedAt = new Date(now()).toISOString();
        // A successful recall after a full day counts twice the initial answer.
        p.evidence = Math.min(12, a.evidence + 2 * resultWeight(type));
      }
      const cap = Math.min(4, 1 + p.retentionEvidence.confirmations);
      p.mastery = Math.min(masteryFromEvidence(p), Math.max(a.mastery, cap));
    }
  };

  v76UpdateMemoryAfterOutcome = function(v, p, pending, ctx) {
    const a = active;
    if (!a || a.p !== p) return update(v, p, pending, ctx);
    const before = {...ctx.model};
    // A resumed retry after 24h is a delayed recall, regardless of session ID.
    update(v, p, a.kind === 'delayed' ? {...pending, isRetry: false} : pending, ctx);
    if (pending.outcome !== 'got' || a.kind !== 'practice') return;
    const m = ctx.model;
    m.stabilityDays = before.stabilityDays;
    m.difficulty = before.difficulty;
    p.recentMistakeUntil = a.recentMistakeUntil;
    // A retry schedules tomorrow's check once. Repeated short practice cannot
    // keep postponing it, or extend a previously established review interval.
    const due = Date.parse(a.nextReview || '');
    p.nextReview = a.lastRating === 'miss'
      ? new Date(ctx.nowMs + WASEDA_DELAYED_RETENTION_POLICY.minimumGapMs).toISOString()
      : (Number.isFinite(due) ? a.nextReview : new Date(ctx.nowMs + WASEDA_DELAYED_RETENTION_POLICY.minimumGapMs).toISOString());
    m.lastIntervalDays = Math.max(0, (Date.parse(p.nextReview) - ctx.nowMs) / 86400000);
    m.targetRetention = v76TargetRetention(v, p);
  };

  // Upstream imports take maximum evidence/mastery, which could erase a new
  // miss penalty (negative evidence) against an empty device's default zero.
  // For policy-aware records, retain the newest assessment, including lapses.
  const merge = mergeImported;
  mergeImported = function(raw) {
    const incoming = (raw.state || raw).words || {}, latest = new Map();
    for (const [id, ip] of Object.entries(incoming)) {
      const cp = state.words[id];
      const chosen = !cp || Date.parse(ip.lastStudied || '') >= Date.parse(cp.lastStudied || '') || !cp.lastStudied ? ip : cp;
      if (chosen.retentionEvidence?.version === 1) latest.set(id, {
        evidence: chosen.evidence, mastery: chosen.mastery,
        retentionEvidence: {...chosen.retentionEvidence},
      });
    }
    merge(raw);
    for (const [id, assessment] of latest) Object.assign(state.words[id], assessment);
    if (latest.size) { saveState(); hydrateUiFromState(); }
  };
})();
