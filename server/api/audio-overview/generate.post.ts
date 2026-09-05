import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES } from "../../../convex/lib/audioOverviewPolicy";
import { makeConvexClient } from "../../utils/convex-client";
import { getConvexTokenIdentifier } from "../../utils/convex-identity";
import {
  deriveAudioOverviewJobCapability,
  isAudioOverviewIdempotencyKey,
} from "../../utils/audio-overview-job-auth";
import { readConfiguredRuntimeValue } from "../../utils/runtime-config";
import { getScopedR2ObjectIdentity } from "../../utils/r2-folder";

type WorkflowStarter = { fetch(request: Request): Promise<Response> };

class WorkflowLaunchError extends Error {
  constructor(
    message: string,
    readonly definitive: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WorkflowLaunchError";
  }
}

type AudioOverviewRequestBody = {
  taskId?: string;
  folderId?: string;
  scope?: { mode: "folder" } | { mode: "explicit"; documentIds: string[] };
  preferences?: {
    lengthMinutes: 5 | 10 | 20;
    complexity: "beginner" | "expert";
  };
  voiceProfile?: unknown;
  idempotencyKey?: string;
};

// Temporary persistence adapter for the pre-v2 task shape. This value is not
// accepted from the client and is never used by the Gemini Audio Renderer.
const LEGACY_TASK_AUDIO_PROFILE = { hostA: "asteria", hostB: "orion" } as const;
const WORKFLOW_LAUNCH_ATTEMPTS = 3;
const WORKFLOW_LAUNCH_TIMEOUT_MS = 1_500;

function validateCommand(body: AudioOverviewRequestBody | null | undefined) {
  if (!body?.folderId || typeof body.folderId !== "string")
    throw createError({ statusCode: 400, message: "folderId is required" });
  if (!body.scope)
    throw createError({ statusCode: 400, message: "scope is required" });
  if (body.scope.mode !== "folder" && body.scope.mode !== "explicit")
    throw createError({ statusCode: 400, message: "scope mode is invalid" });
  if (body.scope.mode === "explicit") {
    if (
      !Array.isArray(body.scope.documentIds) ||
      body.scope.documentIds.length < 1 ||
      body.scope.documentIds.length > AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES ||
      body.scope.documentIds.some((id) => typeof id !== "string" || !id.trim())
    ) {
      throw createError({
        statusCode: 400,
        message: "explicit scope documentIds are invalid",
      });
    }
  }
  if (
    !body.preferences ||
    ![5, 10, 20].includes(body.preferences.lengthMinutes) ||
    !["beginner", "expert"].includes(body.preferences.complexity)
  ) {
    throw createError({ statusCode: 400, message: "preferences are invalid" });
  }
  if (body.voiceProfile !== undefined) {
    throw createError({
      statusCode: 400,
      message: "Audio Overview voices are managed and cannot be overridden",
    });
  }
  if (!isAudioOverviewIdempotencyKey(body.idempotencyKey))
    throw createError({
      statusCode: 400,
      message: "A valid idempotencyKey is required",
    });
}

function reservationError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/already active|generation is not available/i.test(message))
    throw createError({ statusCode: 409, message });
  if (/daily audio overview quota/i.test(message))
    throw createError({ statusCode: 429, message });
  if (
    /folder not found|source not found|not ready|requires at least|exceeds the source limit|has no ready sources|immutable revision|outside the requested folder|invalid job capability|idempotency/i.test(
      message,
    )
  ) {
    throw createError({ statusCode: 400, message });
  }
  throw error;
}

function getOrchestrationToken(event: any): string {
  const config = useRuntimeConfig(event);
  const token = readConfiguredRuntimeValue(
    config.audioOverviewWorkerToken,
    "NUXT_AUDIO_OVERVIEW_WORKER_TOKEN",
    "AUDIO_OVERVIEW_WORKER_TOKEN",
  );
  if (!token || token.length < 32) {
    throw createError({
      statusCode: 503,
      message: "Audio overview generation plane is not configured",
    });
  }
  return token;
}

async function repairLegacySourceIdentities(
  event: any,
  convexClient: ReturnType<typeof makeConvexClient> & {},
  body: AudioOverviewRequestBody,
): Promise<number> {
  const documents = await convexClient.query(
    api.documents.listDocumentsByFolder,
    {
      folderId: body.folderId as Id<"folders">,
    },
  );
  const selectedIds =
    body.scope?.mode === "explicit" ? new Set(body.scope.documentIds) : null;
  const legacySources = documents.filter((document) => {
    if (selectedIds && !selectedIds.has(String(document._id))) return false;
    const contentHash = document.contentHash?.trim().toLowerCase() ?? "";
    return (
      !/^[a-f0-9]{64}$/.test(contentHash) ||
      document.sourceRevision?.trim() !== `sha256:${contentHash}`
    );
  });
  if (legacySources.length === 0) return 0;

  const identities = await Promise.all(
    legacySources.map(async (document) => {
      if (document.status !== "success" || !document.r2Key) {
        throw createError({
          statusCode: 409,
          message: "A selected source cannot be re-indexed automatically",
        });
      }
      const identity = await getScopedR2ObjectIdentity(document.r2Key);
      return { document, identity };
    }),
  );
  const orchestrationToken = getOrchestrationToken(event);
  let repairing = 0;
  for (const { document, identity } of identities) {
    const result = await convexClient.mutation(
      api.documents.prepareAudioOverviewSourceRepair,
      {
        documentId: document._id,
        expectedR2Key: document.r2Key!,
        contentHash: identity.contentHash,
        sourceRevision: `sha256:${identity.contentHash}`,
        orchestrationToken,
      },
    );
    if (result.repairing) repairing += 1;
  }
  return repairing;
}

async function startWorkflow(
  event: any,
  payload: { jobId: string; capability: string },
) {
  const config = useRuntimeConfig(event);
  let workerToken: string;
  try {
    workerToken = getOrchestrationToken(event);
  } catch {
    throw new WorkflowLaunchError(
      "Audio overview Workflow authentication is not configured",
      true,
    );
  }

  const request = new Request("https://audio-overview-worker.internal/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workerToken}`,
    },
    body: JSON.stringify(payload),
  });
  const cloudflareEnv = event.context.cloudflare?.env as
    | Record<string, unknown>
    | undefined;
  const binding = cloudflareEnv?.AUDIO_OVERVIEW_WORKFLOW as
    | WorkflowStarter
    | undefined;
  let response: Response;
  if (binding?.fetch) response = await binding.fetch(request);
  else {
    const workerUrl = readConfiguredRuntimeValue(
      config.audioOverviewWorkerUrl,
      "NUXT_AUDIO_OVERVIEW_WORKER_URL",
      "AUDIO_OVERVIEW_WORKER_URL",
    );
    if (!workerUrl || !import.meta.dev)
      throw new WorkflowLaunchError(
        "Audio overview Workflow binding is not configured",
        true,
      );
    response = await fetch(new URL("/start", workerUrl), {
      method: request.method,
      headers: request.headers,
      body: await request.text(),
    });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const configurationRejected =
      response.status === 503 && /not configured/i.test(detail);
    throw new WorkflowLaunchError(
      `Audio overview Workflow launch failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      configurationRejected ||
        (response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429),
      response.status,
    );
  }
}

async function withLaunchTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new WorkflowLaunchError(
                "Audio overview Workflow launch timed out",
                false,
              ),
            ),
          WORKFLOW_LAUNCH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function startDeterministicWorkflow(
  event: any,
  payload: { jobId: string; capability: string },
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= WORKFLOW_LAUNCH_ATTEMPTS; attempt += 1) {
    try {
      await withLaunchTimeout(startWorkflow(event, payload));
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof WorkflowLaunchError && error.definitive) throw error;
    }
  }
  throw (
    lastError ??
    new WorkflowLaunchError(
      "Audio overview Workflow launch failed after bounded retries",
      false,
    )
  );
}

export default defineEventHandler(async (event) => {
  const userId = getConvexTokenIdentifier(event);
  const body = await readBody<AudioOverviewRequestBody>(event);
  const convexClient = makeConvexClient(event);
  if (!convexClient)
    throw createError({
      statusCode: 500,
      message: "Convex client unavailable",
    });
  const config = useRuntimeConfig(event);
  const jobSecret = readConfiguredRuntimeValue(
    config.audioOverviewJobSecret,
    "NUXT_AUDIO_OVERVIEW_JOB_SECRET",
    "AUDIO_OVERVIEW_JOB_SECRET",
  );
  if (!jobSecret)
    throw createError({
      statusCode: 503,
      message: "Audio overview jobs are not configured",
    });

  const legacyTaskId = body?.taskId?.trim();
  let idempotencyKey: string;
  let capability: string;
  let result: {
    jobId: Id<"audioOverviewJobs">;
    taskId: Id<"tasks">;
    duplicate: boolean;
    status: "accepted" | "running" | "completed" | "failed" | "cancelled";
    quota: { used: number; cap: number; date: string };
    budget: { reservedMicrousd: number };
  };
  if (legacyTaskId && !body?.folderId) {
    idempotencyKey = `legacy_${legacyTaskId}`;
    capability = await deriveAudioOverviewJobCapability(
      jobSecret,
      userId,
      idempotencyKey,
    );
    result = await convexClient
      .mutation(api.audioOverviewJobs.adoptLegacyRequest, {
        taskId: legacyTaskId as Id<"tasks">,
        idempotencyKey,
        capability,
      })
      .catch(reservationError);
  } else {
    validateCommand(body);
    idempotencyKey = body!.idempotencyKey!;
    capability = await deriveAudioOverviewJobCapability(
      jobSecret,
      userId,
      idempotencyKey,
    );
    try {
      result = await convexClient.mutation(api.audioOverviewJobs.request, {
        folderId: body!.folderId as Id<"folders">,
        scope:
          body!.scope!.mode === "explicit"
            ? {
                mode: "explicit" as const,
                documentIds: body!.scope!.documentIds as Id<"documents">[],
              }
            : { mode: "folder" as const },
        preferences: body!.preferences!,
        voiceProfile: LEGACY_TASK_AUDIO_PROFILE,
        idempotencyKey,
        capability,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/authoritative immutable revision/i.test(message)) {
        const repairing = await repairLegacySourceIdentities(
          event,
          convexClient,
          body!,
        );
        if (repairing > 0) {
          throw createError({
            statusCode: 409,
            message: `${repairing} selected source${repairing === 1 ? " is" : "s are"} re-indexing with immutable metadata. Try again when indexing completes.`,
          });
        }
      }
      reservationError(error);
    }
  }
  const terminal =
    result.status === "completed" ||
    result.status === "failed" ||
    result.status === "cancelled";
  if (!terminal) {
    try {
      await startDeterministicWorkflow(event, {
        jobId: String(result.jobId),
        capability,
      });
    } catch (error: unknown) {
      console.error("[audio-overview/generate] Workflow launch failed", error);
      const definitive =
        error instanceof WorkflowLaunchError && error.definitive;
      if (definitive) {
        await convexClient
          .mutation(api.audioOverviewJobs.fail, {
            jobId: result.jobId,
            capability,
            error: "Audio overview Workflow could not be started",
          })
          .catch((failure) =>
            console.error(
              "[audio-overview/generate] Failed to close unstarted job",
              failure,
            ),
          );
      }
      const configurationRejected =
        error instanceof WorkflowLaunchError &&
        /generation plane is not configured/i.test(error.message);
      throw createError({
        statusCode: 503,
        message: configurationRejected
          ? "Audio overview generation plane is not configured"
          : "Audio overview Workflow is temporarily unavailable",
      });
    }
  }
  setResponseStatus(event, terminal ? 200 : 202);
  return {
    accepted: result.status !== "failed" && result.status !== "cancelled",
    status: result.status,
    duplicate: result.duplicate,
    taskId: result.taskId,
    jobId: result.jobId,
    quota: result.quota,
    budget: result.budget,
  };
});
