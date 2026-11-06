import { mutation, query } from './_generated/server'
import { requireOwnedReport, requireOwnedReportGrant } from './lib/learnV2PublicAccess'
import {
  aggregateExportValidator, parsePublicLearnRequest, reportCellsValidator, reportPageArgs, reportPageSchema,
  reportReferenceArgs, reportReferenceSchema, reportValidator, requestReportArgs, requestReportSchema, requestReportValidator,
  type LearnV2AggregateExport, type LearnV2Report, type LearnV2ReportCells, type LearnV2ReportRequest,
} from './lib/learnV2PublicContract'
import { LEARN_V2_MEASUREMENT_REPORT_VERSION } from '../shared/learn-v2-measurement-report'

const disabled = () => ({ version: LEARN_V2_MEASUREMENT_REPORT_VERSION, status: 'disabled' as const, reasonCodes: ['disabled', 'protocol_not_frozen'] })

export const requestReport = mutation({
  args: requestReportArgs, returns: requestReportValidator,
  handler: async (ctx, args): Promise<LearnV2ReportRequest> => {
    const request = parsePublicLearnRequest(requestReportSchema, args)
    await requireOwnedReportGrant(ctx, request.viewerGrantId)
    return disabled()
  },
})

export const getReport = query({
  args: reportReferenceArgs, returns: reportValidator,
  handler: async (ctx, args): Promise<LearnV2Report> => {
    const request = parsePublicLearnRequest(reportReferenceSchema, args)
    await requireOwnedReport(ctx, request.reportRunId)
    return disabled()
  },
})

export const getReportCells = query({
  args: reportPageArgs, returns: reportCellsValidator,
  handler: async (ctx, args): Promise<LearnV2ReportCells> => {
    const request = parsePublicLearnRequest(reportPageSchema, args)
    await requireOwnedReport(ctx, request.reportRunId)
    return disabled()
  },
})

export const exportAggregateReport = query({
  args: reportPageArgs, returns: aggregateExportValidator,
  handler: async (ctx, args): Promise<LearnV2AggregateExport> => {
    const request = parsePublicLearnRequest(reportPageSchema, args)
    await requireOwnedReport(ctx, request.reportRunId)
    return disabled()
  },
})
