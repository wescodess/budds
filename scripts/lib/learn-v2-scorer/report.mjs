import assert from 'node:assert/strict'
import { canonical, hash } from './artifacts.mjs'
import { THRESHOLD_POLICY } from './contract.mjs'

const valid = result => result?.status === 'valid'
const missing = result => result ?? { status: 'not_dispatched', scorePercent: null, criteria: null }
const vector = result => canonical([...result.criteria].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
const bounds = (errors, unavailable, denominator) => ({ errors, unavailable, denominator,
  rate: unavailable === 0 && denominator > 0 ? errors / denominator : null,
  lower: denominator ? errors / denominator : null, upper: denominator ? (errors + unavailable) / denominator : null })

function counts(rows, results, threshold = 80) {
  const stats = { scheduled: rows.length, available: 0, unavailable: 0, statuses: {},
    referencePositive: 0, referenceNegative: 0, falsePass: 0, falseBlock: 0, unavailablePositive: 0, unavailableNegative: 0,
    criterion: { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0, unavailable: 0 }, scoreErrors: {} }
  for (const row of rows) {
    const result = missing(results.get(row.id))
    stats.statuses[result.status] = (stats.statuses[result.status] ?? 0) + 1
    stats[row.expected.referencePass ? 'referencePositive' : 'referenceNegative']++
    if (!valid(result)) {
      stats.unavailable++
      stats[row.expected.referencePass ? 'unavailablePositive' : 'unavailableNegative']++
      stats.criterion.unavailable += Object.keys(row.expected.criteria).length
      continue
    }
    stats.available++
    const pass = result.scorePercent >= threshold
    if (pass && !row.expected.referencePass) stats.falsePass++
    if (!pass && row.expected.referencePass) stats.falseBlock++
    const expected = Object.values(row.expected.criteria)
    let correctWeight = 0
    for (const [index, award] of expected.entries()) {
      const key = `k${index + 1}`
      const observed = result.criteria.find(criterion => criterion.key === key).awarded
      stats.criterion[award ? observed ? 'truePositive' : 'falseNegative' : observed ? 'falsePositive' : 'trueNegative']++
      if (award) correctWeight += result.weights[index]
    }
    const delta = String(result.scorePercent - correctWeight)
    stats.scoreErrors[delta] = (stats.scoreErrors[delta] ?? 0) + 1
  }
  return { ...stats, falsePassBounds: bounds(stats.falsePass, stats.unavailableNegative, stats.referenceNegative),
    falseBlockBounds: bounds(stats.falseBlock, stats.unavailablePositive, stats.referencePositive) }
}

// Depends only on source-proven vectors, rubric weights and the frozen comparator.
function thresholdCounterexamples(rows, sources) {
  const found = { falsePass: 0, falseBlock: 0 }
  for (const row of rows) {
    const { atoms } = sources.packets.find(packet => packet.id === row.packetId)
    const pass = atoms.reduce((sum, atom) => sum + (row.expected.criteria[atom.id] ? atom.weight : 0), 0) >= THRESHOLD_POLICY.baseline
    if (pass && !row.expected.referencePass) found.falsePass++
    if (!pass && row.expected.referencePass) found.falseBlock++
  }
  return found
}

function upstreamResults(adapter, corpus, output) {
  const observed = row => output.get(row.id)?.identity?.servingProvider ?? null
  const sets = { core: corpus.core, controls: corpus.controls, repeats: corpus.repeats, diagnostics: corpus.diagnostics }
  const all = Object.values(sets).flat()
  const among = (rows, upstream) => rows.filter(row => observed(row) === upstream)
  return { served: [...new Set(all.map(observed))].filter(upstream => upstream !== null).sort().map(upstream => ({ upstream,
    matchesInventory: upstream === adapter.upstream, scheduled: among(all, upstream).length,
    ...Object.fromEntries(Object.entries(sets).map(([name, rows]) => [name, counts(among(rows, upstream), output)])) })),
  unobserved: among(all, null).length }
}

function upstreamClaimBlocker({ served }) {
  if (served.length > 1) return 'mixed_upstream'
  return served.length === 1 && !served[0].matchesInventory ? 'inventory_upstream_mismatch' : null
}

function graderResult(sets, repeats) {
  const criterionErrors = sets.reduce((sum, set) => sum + set.criterion.falsePositive + set.criterion.falseNegative, 0)
  const unavailable = sets.reduce((sum, set) => sum + set.unavailable, 0) + repeats.unavailablePairs
  return { status: criterionErrors || repeats.disagreements ? 'errors_observed' : unavailable ? 'unavailable_evidence' : 'no_errors_observed',
    criterionErrors, unavailable, repeatDisagreements: repeats.disagreements }
}

function strata(rows, results, field) {
  return Object.fromEntries([...new Set(rows.map(row => row[field]))].sort().map(value => [value, counts(rows.filter(row => row[field] === value), results)]))
}

export function fitThresholds(corpus, adapters, results, sealDigests) {
  const fit = corpus.core.filter(row => row.split === 'fit')
  assert.equal(fit.length, 112)
  return { policy: THRESHOLD_POLICY, phase: 'frozen_before_heldout',
    fitVerdictDigests: [...sealDigests].sort(),
    configurations: Object.fromEntries(adapters.map(adapter => {
      const output = results.get(adapter.id) ?? new Map()
      const complete = fit.every(row => valid(output.get(row.id)))
      const attainable = [...new Set(fit.flatMap(row => valid(output.get(row.id)) ? [output.get(row.id).scorePercent] : []))].sort((a, b) => a - b)
      const candidates = complete ? attainable.map(percent => ({ percent, stats: counts(fit, output, percent) })) : []
      const candidate = candidates.find(({ stats }) => stats.falsePassBounds.rate <= THRESHOLD_POLICY.falsePassAlarm
        && stats.falseBlockBounds.rate <= THRESHOLD_POLICY.falseBlockAlarm)
      return [adapter.id, { baseline: 80, candidate: candidate?.percent ?? null, fitCount: fit.length, fitPackets: 8,
        status: !complete ? 'unavailable_fit' : candidate ? 'frozen_provisional' : 'no_candidate_meets_alarms',
        selectionEvidence: candidates.map(({ percent, stats }) => ({ percent, falsePass: stats.falsePassBounds, falseBlock: stats.falseBlockBounds })) }]
    })) }
}

function compare(rows, left, right) {
  const result = { scheduled: rows.length, availablePairs: 0, unavailablePairs: 0, criterionDisagreements: 0,
    leftPassRightBlock: 0, leftBlockRightPass: 0, passPass: 0, blockBlock: 0 }
  for (const row of rows) {
    const a = left.get(row.id)
    const b = right.get(row.id)
    if (!valid(a) || !valid(b)) { result.unavailablePairs++; continue }
    result.availablePairs++
    if (vector(a) !== vector(b)) result.criterionDisagreements++
    result[a.scorePercent >= 80 ? b.scorePercent >= 80 ? 'passPass' : 'leftPassRightBlock' : b.scorePercent >= 80 ? 'leftBlockRightPass' : 'blockBlock']++
  }
  return result
}

export function anchorReport(anchors) {
  // Synthetic local joins only. No inference, human vote or application mutation.
  assert.equal(anchors.version, 'learn-v2.synthetic-anchor-checks.v1')
  assert.equal(anchors.evidenceStatus, 'synthetic_contract_only')
  assert.ok(Array.isArray(anchors.rows) && anchors.rows.length <= 256, 'Synthetic anchor snapshot exceeds its bound')
  const byFlowHorizon = {}
  const observations = []
  for (const row of anchors.rows) {
    assert.ok(['v2_today', 'v2_canvas'].includes(row.flow) && [7, 30].includes(row.horizon))
    const key = `${row.flow}/day${row.horizon}`
    const stats = byFlowHorizon[key] ??= { eligible: 0, submitted: 0, valid: 0, missed: 0, assisted: 0, unscored: 0,
      invalid: 0, observedFailures: 0, excludedCanvas: 0 }
    if (row.flow === 'v2_canvas' && !anchors.canvasAdmitted) { stats.excludedCanvas++; continue }
    stats.eligible++
    const validWindow = [row.windowStart, row.windowEnd].every(value => Number.isSafeInteger(value) && value >= 0)
      && row.windowStart <= row.windowEnd
    if (!validWindow) { stats.invalid++; continue }
    if (row.submittedAt === null) { stats.missed++; continue }
    stats.submitted++
    if (![row.submittedAt, row.acceptedAt].every(value => Number.isSafeInteger(value) && value >= 0)) { stats.invalid++; continue }
    if (row.assisted !== false) { stats.assisted++; continue }
    if (row.scorePercent === null) { stats.unscored++; continue }
    assert.ok(Number.isFinite(row.scorePercent) && row.scorePercent >= 0 && row.scorePercent <= 100)
    const cases = [row.coldCase, row.delayedCase, ...(row.horizon === 30 ? [row.day7Case] : [])]
    const validJoin = row.acceptedAt === row.submittedAt && row.sourceAvailable === true && row.novel === true
      && row.exposedBeforeAcceptance === false && row.pinsMatch === true
      && row.submittedAt >= row.windowStart && row.submittedAt <= row.windowEnd
      && cases.every(value => typeof value === 'string' && value.trim().length > 0) && new Set(cases).size === cases.length
    if (!validJoin) { stats.invalid++; continue }
    stats.valid++
    if (row.scorePercent < 80) stats.observedFailures++
    observations.push({ id: row.id, status: row.scorePercent < 80 ? 'valid_observed_delayed_failure' : 'valid_observed_delayed_pass',
      validationClaim: row.divergent ? 'quarantined' : 'synthetic_only' })
  }
  return { evidenceStatus: 'synthetic_contract_only', realAnchorValidity: 'pending_real_delayed_evidence',
    byFlowHorizon: Object.fromEntries(Object.entries(byFlowHorizon).map(([key, value]) => [key, { ...value,
      observedFalseMastery: { failures: value.observedFailures, validChecks: value.valid, rate: value.valid ? value.observedFailures / value.valid : null },
      falseMasteryBounds: bounds(value.observedFailures, value.eligible - value.valid, value.eligible) }])), observations }
}

export function buildReport({ pins, pinsDigest, corpus, sources, schedule, results, thresholds, artifacts, reservations, halted = null }) {
  const reports = {}
  const quarantine = []
  const counterexamples = { threshold: THRESHOLD_POLICY.baseline, core: thresholdCounterexamples(corpus.core, sources),
    controls: thresholdCounterexamples(corpus.controls, sources), diagnostics: thresholdCounterexamples(corpus.diagnostics, sources) }
  const counterexampleFound = [counterexamples.core, counterexamples.controls, counterexamples.diagnostics].some(set => set.falsePass || set.falseBlock)
  for (const adapter of pins.adapters) {
    const output = results.get(adapter.id) ?? new Map()
    const core = counts(corpus.core, output)
    const threshold = thresholds.configurations[adapter.id]
    const controls = counts(corpus.controls, output)
    const diagnostics = counts(corpus.diagnostics, output)
    const repeats = { scheduled: 20, availablePairs: 0, disagreements: 0, unavailablePairs: 0 }
    for (const row of corpus.repeats) {
      const a = output.get(row.id)
      const b = output.get(row.repeatOf)
      if (!valid(a) || !valid(b)) { repeats.unavailablePairs++; continue }
      repeats.availablePairs++
      if (vector(a) !== vector(b)) repeats.disagreements++
    }
    const grader = graderResult([core, controls, diagnostics], repeats)
    const observedUpstreams = adapter.role === 'baseline' ? upstreamResults(adapter, corpus, output) : null
    const blockers = [grader.unavailable && 'unavailable_evidence', (grader.criterionErrors || grader.repeatDisagreements) && 'source_or_repeat_divergence',
      observedUpstreams && upstreamClaimBlocker(observedUpstreams), counterexampleFound && 'threshold_counterexample'].filter(Boolean)
    for (const reason of blockers) quarantine.push({ configuration: adapter.configuration, adapter: adapter.id, status: 'quarantined_validation_claim', reason })
    reports[adapter.id] = { model: adapter.model, configuration: adapter.configuration, inventoryUpstream: adapter.upstream, observedUpstreams, graderResult: grader,
      scheduled: schedule.filter(item => item.adapter === adapter.id).length, core,
      thresholdFinding: { threshold: 80, classification: 'threshold_comparison_not_criterion_divergence',
        falsePass: core.falsePassBounds, falseBlock: core.falseBlockBounds },
      fit: counts(corpus.core.filter(row => row.split === 'fit'), output), heldout: counts(corpus.core.filter(row => row.split === 'heldout'), output),
      candidateHeldout: threshold.candidate === null ? null : counts(corpus.core.filter(row => row.split === 'heldout'), output, threshold.candidate),
      domain: strata(corpus.core, output, 'domain'), form: strata(corpus.core, output, 'formId'),
      packet: strata(corpus.core, output, 'packetId'), seedClass: strata(corpus.core, output, 'seedClass'),
      controls, repeats, diagnostics,
      uncertainty: { unit: 'source_packet', fitClusters: 8, heldoutClusters: 8, independentLearners: 0,
        interpretation: 'descriptive_correlated_synthetic_counts_only_no_population_accuracy_claim' } }
  }
  const disagreement = {}
  for (let left = 0; left < pins.adapters.length; left++) for (let right = left + 1; right < pins.adapters.length; right++) {
    const a = pins.adapters[left]
    const b = pins.adapters[right]
    if (a.configuration === b.configuration) disagreement[`${a.id}/${b.id}`] = compare(corpus.core, results.get(a.id) ?? new Map(), results.get(b.id) ?? new Map())
  }
  const complete = pins.adapters.every(adapter => {
    const output = results.get(adapter.id) ?? new Map()
    return schedule.filter(item => item.adapter === adapter.id).every(item => valid(output.get(item.rowId)))
  })
  return { version: 'learn-v2.scorer-report.v1', evidenceStatus: pins.evidenceStatus, pinsDigest,
    realAnchorValidity: 'pending_real_delayed_evidence', complete, liveRuns: pins.mode === 'offline' ? 'unrun_requires_separate_owner_approval' : 'captured_not_promoted',
    consistencyClaim: pins.mode === 'offline' ? 'offline_contract_only' : complete && !quarantine.length ? 'provisional_consistency_pass' : 'unavailable',
    consistencyClaimBlockers: [...new Set(quarantine.map(row => row.reason))].sort(), halted,
    graderResults: Object.fromEntries(Object.entries(reports).map(([id, report]) => [id, report.graderResult.status])),
    baselineThreshold: 80, thresholdCounterexamples: counterexamples, thresholdDigest: hash(thresholds), thresholds, configurations: reports, disagreement, quarantine,
    anchors: anchorReport(pins.anchors), reservations, verdictArtifacts: [...artifacts].sort(),
    authority: { applicationWrites: 0, masteryWrites: 0, humanGrading: false, voting: false, promotion: false } }
}
