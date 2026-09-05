import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";

const mockMutation = vi.fn();
const mockQuery = vi.fn();
const mockBindingFetch = vi.fn();
const mockSetResponseStatus = vi.fn();
const mockGetScopedR2ObjectIdentity = vi.fn();
const WORKER_TOKEN = "launch-secret-at-least-32-characters-long";

vi.stubGlobal("defineEventHandler", (handler: Function) => handler);
vi.stubGlobal("readBody", vi.fn());
vi.stubGlobal("setResponseStatus", mockSetResponseStatus);
vi.stubGlobal("createError", (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
);
vi.stubGlobal(
  "useRuntimeConfig",
  vi.fn(() => ({
    audioOverviewJobSecret: "job-secret",
    audioOverviewWorkerToken: WORKER_TOKEN,
  })),
);

vi.mock("../../utils/convex-client", () => ({
  makeConvexClient: vi.fn(() => ({ mutation: mockMutation, query: mockQuery })),
}));
vi.mock("../../utils/convex-identity", () => ({
  getConvexTokenIdentifier: vi.fn(() => "user-id"),
}));
vi.mock("../../utils/r2-folder", () => ({
  getScopedR2ObjectIdentity: mockGetScopedR2ObjectIdentity,
}));
vi.mock("../../utils/audio-overview-job-auth", () => ({
  deriveAudioOverviewJobCapability: vi.fn(async () => "c".repeat(43)),
  isAudioOverviewIdempotencyKey: vi.fn(
    (value: unknown) => typeof value === "string" && value.length >= 16,
  ),
}));
vi.mock("../../utils/runtime-config", () => ({
  readConfiguredRuntimeValue: vi.fn((...values: unknown[]) =>
    values.find(Boolean),
  ),
}));

const handler = (await import("./generate.post")).default as Function;
const validBody = {
  folderId: "folder_owned",
  scope: { mode: "folder" },
  preferences: { lengthMinutes: 10, complexity: "beginner" },
  idempotencyKey: "request_key_123456789",
};
function makeEvent() {
  return {
    context: {
      convexToken: "jwt-must-not-leave-pages",
      cloudflare: {
        env: { AUDIO_OVERVIEW_WORKFLOW: { fetch: mockBindingFetch } },
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/audio-overview/generate", () => {
  beforeEach(() => {
    mockMutation.mockReset().mockResolvedValue({
      jobId: "job_1",
      taskId: "task_1",
      duplicate: false,
      quota: { used: 1, cap: 10, date: "2026-09-02" },
      budget: { reservedMicrousd: 190_000 },
    });
    mockQuery.mockReset();
    mockGetScopedR2ObjectIdentity.mockReset();
    mockBindingFetch
      .mockReset()
      .mockResolvedValue(Response.json({ accepted: true }, { status: 202 }));
    mockSetResponseStatus.mockReset();
    vi.mocked(globalThis.readBody as any)
      .mockReset()
      .mockResolvedValue(validBody);
  });

  test("[P0] reserves, launches, and returns 202 without forwarding the user JWT", async () => {
    const event = makeEvent();
    const result = await handler(event);
    expect(mockMutation).toHaveBeenCalledOnce();
    expect(mockMutation.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        idempotencyKey: validBody.idempotencyKey,
        capability: "c".repeat(43),
      }),
    );
    const request = mockBindingFetch.mock.calls[0]?.[0] as Request;
    expect(request.headers.get("Authorization")).toBe(`Bearer ${WORKER_TOKEN}`);
    const serialized = await request.text();
    expect(JSON.parse(serialized)).toEqual({
      jobId: "job_1",
      capability: "c".repeat(43),
    });
    expect(serialized).not.toContain("jwt-must-not-leave-pages");
    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 202);
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        taskId: "task_1",
        jobId: "job_1",
        budget: { reservedMicrousd: 190_000 },
      }),
    );
  });

  test("[P0] rejects a missing idempotency key before reserving quota", async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      ...validBody,
      idempotencyKey: undefined,
    });
    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;
    expect(error.statusCode).toBe(400);
    expect(mockMutation).not.toHaveBeenCalled();
    expect(mockBindingFetch).not.toHaveBeenCalled();
  });

  test("[P0] repairs a legacy indexed source instead of returning an unactionable immutable-revision error", async () => {
    const contentHash = "a".repeat(64);
    mockMutation
      .mockRejectedValueOnce(
        new ConvexError(
          "Source has no authoritative immutable revision; re-index it and try again",
        ),
      )
      .mockResolvedValueOnce({ repairing: true });
    mockQuery.mockResolvedValueOnce([
      {
        _id: "doc_legacy",
        folderId: validBody.folderId,
        filename: "legacy.pdf",
        status: "success",
        r2Key: "owner/folder/doc_legacy.pdf",
      },
    ]);
    mockGetScopedR2ObjectIdentity.mockResolvedValueOnce({
      key: "owner/folder/doc_legacy.pdf",
      contentHash,
      revision: `sha256:${contentHash}`,
      byteLength: 2048,
    });

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(409);
    expect(error.message).toMatch(/re-indexing.*try again/i);
    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockGetScopedR2ObjectIdentity).toHaveBeenCalledWith(
      "owner/folder/doc_legacy.pdf",
    );
    expect(mockMutation).toHaveBeenCalledTimes(2);
    expect(mockMutation.mock.calls[1]?.[1]).toEqual({
      documentId: "doc_legacy",
      expectedR2Key: "owner/folder/doc_legacy.pdf",
      contentHash,
      sourceRevision: `sha256:${contentHash}`,
      orchestrationToken: WORKER_TOKEN,
    });
    expect(mockBindingFetch).not.toHaveBeenCalled();
  });

  test("[P1] adopts a rolling-deployment legacy task without reserving quota twice", async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      taskId: "legacy_task_123456",
    });

    await expect(handler(makeEvent())).resolves.toEqual(
      expect.objectContaining({ accepted: true }),
    );

    expect(mockMutation.mock.calls[0]?.[1]).toEqual({
      taskId: "legacy_task_123456",
      idempotencyKey: "legacy_legacy_task_123456",
      capability: "c".repeat(43),
    });
    expect(mockBindingFetch).toHaveBeenCalledOnce();
  });

  test("[P1] an idempotent reservation can relaunch the deterministic Workflow", async () => {
    mockMutation.mockResolvedValueOnce({
      jobId: "job_1",
      taskId: "task_1",
      duplicate: true,
      quota: { used: 1, cap: 10, date: "2026-09-02" },
    });
    await expect(handler(makeEvent())).resolves.toEqual(
      expect.objectContaining({ duplicate: true }),
    );
    expect(mockBindingFetch).toHaveBeenCalledOnce();
  });

  test("[P0] retries an ambiguous timeout and accepts the active deterministic Workflow duplicate", async () => {
    vi.useFakeTimers();
    mockBindingFetch
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValueOnce(
        Response.json(
          { accepted: true, duplicate: true, id: "audio-job_1" },
          { status: 202 },
        ),
      );

    const pending = handler(makeEvent());
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toEqual(
      expect.objectContaining({ accepted: true }),
    );
    expect(mockBindingFetch).toHaveBeenCalledTimes(2);
    expect(mockMutation).toHaveBeenCalledTimes(1);
    const payloads = await Promise.all(
      mockBindingFetch.mock.calls.map(
        async ([request]) => await (request as Request).json(),
      ),
    );
    expect(payloads).toEqual([
      { jobId: "job_1", capability: "c".repeat(43) },
      { jobId: "job_1", capability: "c".repeat(43) },
    ]);
    vi.useRealTimers();
  });

  test("[P0] keeps a reservation retryable after bounded ambiguous launch failures", async () => {
    mockBindingFetch.mockResolvedValue(
      Response.json({ error: "temporarily unavailable" }, { status: 503 }),
    );

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(503);
    expect(error.message).toBe(
      "Audio overview Workflow is temporarily unavailable",
    );
    expect(mockBindingFetch).toHaveBeenCalledTimes(3);
    expect(mockMutation).toHaveBeenCalledOnce();

    mockMutation.mockResolvedValueOnce({
      jobId: "job_1",
      taskId: "task_1",
      duplicate: true,
      status: "accepted",
      quota: { used: 1, cap: 10, date: "2026-09-02" },
      budget: { reservedMicrousd: 190_000 },
    });
    mockBindingFetch.mockResolvedValueOnce(
      Response.json(
        { accepted: true, duplicate: false, id: "audio-job_1" },
        { status: 202 },
      ),
    );

    await expect(handler(makeEvent())).resolves.toEqual(
      expect.objectContaining({ accepted: true, duplicate: true }),
    );
    expect(mockMutation).toHaveBeenCalledTimes(2);
  });

  test("[P0] terminal-fails a reservation when the Worker reports an unconfigured generation plane", async () => {
    mockBindingFetch.mockResolvedValueOnce(
      Response.json(
        { error: "Audio overview generation plane is not configured" },
        { status: 503 },
      ),
    );

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(503);
    expect(error.message).toBe(
      "Audio overview generation plane is not configured",
    );
    expect(mockBindingFetch).toHaveBeenCalledOnce();
    expect(mockMutation).toHaveBeenCalledTimes(2);
    expect(mockMutation.mock.calls[1]?.[1]).toEqual({
      jobId: "job_1",
      capability: "c".repeat(43),
      error: "Audio overview Workflow could not be started",
    });
  });

  test("[P0] closes an active duplicate after a definitive generation-plane configuration rejection", async () => {
    mockMutation.mockResolvedValueOnce({
      jobId: "job_1",
      taskId: "task_1",
      duplicate: true,
      status: "running",
      quota: { used: 1, cap: 10, date: "2026-09-02" },
    });
    mockBindingFetch.mockResolvedValueOnce(
      Response.json(
        { error: "Audio overview generation plane is not configured" },
        { status: 503 },
      ),
    );

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(503);
    expect(error.message).toBe(
      "Audio overview generation plane is not configured",
    );
    expect(mockMutation).toHaveBeenCalledTimes(2);
    expect(mockMutation.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ jobId: "job_1" }),
    );
  });

  test("[P1] terminal-fails a new reservation after a definitive Worker rejection", async () => {
    mockBindingFetch.mockResolvedValueOnce(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(503);
    expect(mockMutation).toHaveBeenCalledTimes(2);
    expect(mockMutation.mock.calls[1]?.[1]).toEqual({
      jobId: "job_1",
      capability: "c".repeat(43),
      error: "Audio overview Workflow could not be started",
    });
  });

  test("[P0] reconciles an active duplicate when its Workflow instance is terminal", async () => {
    mockMutation.mockResolvedValueOnce({
      jobId: "job_1",
      taskId: "task_1",
      duplicate: true,
      status: "running",
      quota: { used: 1, cap: 10, date: "2026-09-02" },
    });
    mockBindingFetch.mockResolvedValueOnce(
      Response.json({ error: "terminal" }, { status: 409 }),
    );

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(503);
    expect(mockMutation).toHaveBeenCalledTimes(2);
    expect(mockMutation.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ jobId: "job_1" }),
    );
  });

  test("[P0] retries a transient launch rate limit without closing the reservation", async () => {
    mockBindingFetch.mockResolvedValue(
      Response.json({ error: "rate limited" }, { status: 429 }),
    );

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(503);
    expect(mockBindingFetch).toHaveBeenCalledTimes(3);
    expect(mockMutation).toHaveBeenCalledOnce();
  });

  test("[P0] rejects an unknown scope mode instead of broadening it to the folder", async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      ...validBody,
      scope: { mode: "unexpected", documentIds: ["doc_1"] },
    });

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(400);
    expect(mockMutation).not.toHaveBeenCalled();
    expect(mockBindingFetch).not.toHaveBeenCalled();
  });

  test("[P1] accepts the policy maximum of 50 explicit sources", async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      ...validBody,
      scope: {
        mode: "explicit",
        documentIds: Array.from({ length: 50 }, (_, index) => `doc_${index}`),
      },
    });

    await expect(handler(makeEvent())).resolves.toEqual(
      expect.objectContaining({ accepted: true }),
    );
    expect(mockMutation).toHaveBeenCalledOnce();
  });

  test("[P1] rejects explicit scope above the policy maximum", async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      ...validBody,
      scope: {
        mode: "explicit",
        documentIds: Array.from({ length: 51 }, (_, index) => `doc_${index}`),
      },
    });

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(400);
    expect(mockMutation).not.toHaveBeenCalled();
  });

  test("[P2] rejects invalid preferences before calling Convex", async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      ...validBody,
      preferences: { lengthMinutes: 7, complexity: "beginner" },
    });

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(400);
    expect(mockMutation).not.toHaveBeenCalled();
  });

  test("[P2] maps an active-generation conflict to HTTP 409", async () => {
    mockMutation.mockRejectedValueOnce(
      new Error("An audio overview generation is already active"),
    );

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(409);
    expect(mockBindingFetch).not.toHaveBeenCalled();
  });

  test("[P1] rejects deprecated Aura voice overrides instead of accepting a no-op production control", async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      ...validBody,
      voiceProfile: { hostA: "luna", hostB: "orion" },
    });

    const error = (await handler(makeEvent()).catch(
      (reason: unknown) => reason,
    )) as any;

    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/managed and cannot be overridden/i);
    expect(mockMutation).not.toHaveBeenCalled();
    expect(mockBindingFetch).not.toHaveBeenCalled();
  });
});
