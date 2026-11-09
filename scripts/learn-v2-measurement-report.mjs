#!/usr/bin/env node
import { open } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

export const REPLAY_VERSION = 'learn-v2.measurement-report-replay.v1'
export const REDUCER_CODE_VERSION = '0305f427ace92222c2ea3e9ef000abdaae7e2542'
const MAX_FILE_BYTES = 65 * 1024 * 1024

// Node 24 strips types natively. Resolve only this worktree's shared module
// imports; do not transpile, bundle, or load configuration from node_modules.
async function loadContract() {
  const shared = new URL('../shared/', import.meta.url).href
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.startsWith(shared) && /^\.\/[^./]+$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context)
      }
      return nextResolve(specifier, context)
    },
  })
  try { return await import('../shared/learn-v2-measurement-report.ts') }
  finally { hook.deregister() }
}

const readiness = {
  sourceAdmission: 'pending', viewerGrant: 'unverified_offline', realObservations: 'unverified_offline',
  baselineCapture: 'unproven',
  reasonCodes: ['trusted_source_admission_pending', 'viewer_grant_not_verified', 'real_observations_not_verified'],
}

function result(inputClass, status, reasonCodes, manifest = null, cells = []) {
  return { version: REPLAY_VERSION, inputClass, status, reasonCodes, readiness, manifest, cells }
}

async function readInput(path) {
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('invalid_input')
    const chunks = []
    let length = 0
    while (length <= MAX_FILE_BYTES) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - length))
      const { bytesRead } = await handle.read(buffer)
      if (!bytesRead) break
      length += bytesRead
      chunks.push(buffer.subarray(0, bytesRead))
    }
    if (length > MAX_FILE_BYTES) throw new Error('invalid_input')
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  finally { await handle.close() }
}

/** Offline computation only: neither this function nor its input attests source authority. */
export async function replayMeasurementReport(input, inputClass) {
  if (!['fixture_diagnostic', 'sealed_input_replay'].includes(inputClass)) return result('none', 'failed', ['invalid_arguments'])
  try {
    const contract = await loadContract()
    const { z } = await import('zod')
    if (input?.version !== REPLAY_VERSION) return result(inputClass, 'failed', ['incompatible_version'])
    const envelope = z.strictObject({
      version: z.literal(REPLAY_VERSION), report: z.unknown(),
      roster: z.array(contract.learnReportOpaqueKeySchema).max(10_000),
      rows: z.array(z.unknown()).max(40_000),
    }).parse(input)
    if (envelope.report?.version !== contract.LEARN_V2_MEASUREMENT_REPORT_VERSION
      || (envelope.report?.status === 'sealed'
        && (envelope.report.provenance?.sourceVersion !== contract.LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION
          || envelope.report.provenance?.queryVersion !== contract.LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION
          || envelope.report.query?.version !== contract.LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION
          || envelope.report.provenance?.codeVersion !== REDUCER_CODE_VERSION))) {
      return result(inputClass, 'failed', ['incompatible_version'])
    }
    // A missing protocol is unavailable, not a request to invent a schedule.
    if (envelope.report?.status === 'sealed' && !envelope.report.query?.protocolVersion) {
      return result(inputClass, 'unavailable', ['protocol_not_frozen'])
    }
    const report = contract.learnMeasurementReportSchema.parse(envelope.report)
    if (report.status !== 'sealed') {
      return result(inputClass, report.status === 'stale' ? 'stale' : 'unavailable', [`snapshot_${report.status}`])
    }
    const rows = envelope.rows.map(row => contract.learnReportInputSnapshotSchema.parse(row))
    const reconciliation = contract.reconcileLearnReportSourceRows(envelope.roster, rows)
    if (reconciliation.status === 'incomplete') return result(inputClass, 'incomplete', reconciliation.reasonCodes)
    const computed = await contract.buildLearningMeasurementReport({
      reportRunId: report.reportRunId, query: report.query, provenance: report.provenance, roster: envelope.roster, rows,
    })
    if (computed.report.status !== 'sealed') return result(inputClass, computed.report.status, computed.report.reasonCodes)
    const cells = computed.pages.flatMap(page => page.cells)
    const reasonCodes = inputClass === 'fixture_diagnostic' ? ['fixture_only'] : ['offline_replay_only']
    if (report.provenance.sourceCoverage !== 'complete' || cells.some(cell => cell.sourceCoverage !== 'complete')) {
      reasonCodes.push('unknown_source_coverage')
    }
    if (!cells.some(cell => cell.observedValue !== null)) reasonCodes.push('no_observed_outcomes')
    // Closed public DTOs only. Omit run IDs, paging cursors and every source row.
    return result(inputClass, 'replayed', reasonCodes, {
      reportVersion: report.version,
      metricVersions: [contract.VERIFIED_LEARNING_GAIN_VERSION, contract.FALSE_MASTERY_NEXT_DELAYED_VERSION],
      replayVersion: REPLAY_VERSION, cutoffDate: new Date(report.query.cutoff).toISOString(),
      query: report.query, provenance: report.provenance,
    }, cells)
  }
  catch {
    // Never serialize validation errors, paths, offending values or stack traces.
    return result(inputClass, 'failed', ['invalid_input'])
  }
}

export async function main(args = process.argv.slice(2)) {
  let output
  const inputClass = args[0] === '--fixture' ? 'fixture_diagnostic' : args[0] === '--sealed-input' ? 'sealed_input_replay' : 'none'
  if (Number(process.versions.node.split('.')[0]) !== 24) output = result('none', 'failed', ['node_24_required'])
  else if (!args.length) output = result('none', 'unavailable', ['input_required', 'protocol_not_frozen'])
  else if (args.length !== 2 || inputClass === 'none') output = result('none', 'failed', ['invalid_arguments'])
  else {
    try { output = await replayMeasurementReport(await readInput(args[1]), inputClass) }
    catch { output = result(inputClass, 'failed', ['input_unreadable_or_malformed']) }
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  return output.status === 'replayed' ? 0 : output.status === 'failed' || output.status === 'incomplete' ? 1 : 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
