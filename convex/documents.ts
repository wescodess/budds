import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { enqueueDocumentCleanup } from "./accountDeletion";
import { requireAudioOverviewOrchestrationCredential } from "./lib/audioOverviewOrchestrationAuth";
import { getOptionalAuthUserId, requireAuth } from "./lib/auth";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);

    return await ctx.storage.generateUploadUrl();
  },
});

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const createDocument = mutation({
  args: {
    folderId: v.id("folders"),
    filename: v.string(),
    fileId: v.id("_storage"),
    fileSize: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.userId !== userId) {
      throw new Error("Folder not found");
    }

    const metadata = await ctx.db.system.get(args.fileId);
    if (!metadata) throw new Error("File not found in storage");
    if (metadata.contentType && !ALLOWED_MIME_TYPES.has(metadata.contentType)) {
      throw new Error("Unsupported file type");
    }
    if (metadata.size > 52_428_800) {
      throw new Error("File exceeds 50MB limit");
    }

    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      userId,
      folderId: args.folderId,
      type: "document-ingestion",
      status: "pending",
      title: `Ingesting ${args.filename}`,
      progress: "Uploading to storage…",
      createdAt: now,
      updatedAt: now,
    });

    const docId = await ctx.db.insert("documents", {
      userId,
      folderId: args.folderId,
      filename: args.filename,
      fileId: args.fileId,
      status: "processing",
      fileSize: metadata.size,
      sourceType: "file",
      mimeType: metadata.contentType ?? undefined,
      taskId,
    });

    await ctx.db.patch(args.folderId, {
      documentCount: folder.documentCount + 1,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: args.fileId,
      userId,
      folderId: args.folderId,
      filename: args.filename,
      sourceType: "file",
      mimeType: metadata.contentType ?? undefined,
      taskId,
    });

    return docId;
  },
});

export const createDocumentFromSource = mutation({
  args: {
    folderId: v.id("folders"),
    filename: v.string(),
    sourceType: v.union(v.literal("website"), v.literal("youtube")),
    sourceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.userId !== userId) {
      throw new Error("Folder not found");
    }

    const label = args.sourceType === "youtube" ? "YouTube video" : "website";
    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      userId,
      folderId: args.folderId,
      type: "document-ingestion",
      status: "pending",
      title: `Importing ${label}`,
      progress:
        args.sourceType === "youtube"
          ? "Fetching transcript…"
          : "Extracting content…",
      metadata: { sourceUrl: args.sourceUrl, sourceType: args.sourceType },
      createdAt: now,
      updatedAt: now,
    });

    const docId = await ctx.db.insert("documents", {
      userId,
      folderId: args.folderId,
      filename: args.filename,
      status: "processing",
      fileSize: 0,
      sourceType: args.sourceType,
      sourceUrl: args.sourceUrl,
      taskId,
    });

    await ctx.db.patch(args.folderId, {
      documentCount: folder.documentCount + 1,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.documentActions.ingestDocument, {
      documentId: docId,
      userId,
      folderId: args.folderId,
      filename: args.filename,
      sourceType: args.sourceType,
      sourceUrl: args.sourceUrl,
      taskId,
    });

    return docId;
  },
});

export const createDocumentFromText = mutation({
  args: {
    folderId: v.id("folders"),
    filename: v.string(),
    text: v.string(),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.userId !== userId) {
      throw new Error("Folder not found");
    }

    if (!args.text.trim()) throw new Error("Text content cannot be empty");

    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      userId,
      folderId: args.folderId,
      type: "document-ingestion",
      status: "pending",
      title: `Ingesting ${args.filename}`,
      progress: "Preparing…",
      createdAt: now,
      updatedAt: now,
    });

    const docId = await ctx.db.insert("documents", {
      userId,
      folderId: args.folderId,
      filename: args.filename,
      status: "processing",
      fileSize: new TextEncoder().encode(args.text).length,
      sourceType: "file",
      sourceUrl: args.sourceUrl,
      mimeType: "text/markdown",
      taskId,
    });

    await ctx.db.patch(args.folderId, {
      documentCount: folder.documentCount + 1,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.documentActions.ingestText, {
      documentId: docId,
      userId,
      folderId: args.folderId,
      filename: args.filename,
      text: args.text,
      taskId,
    });

    return docId;
  },
});

export const listDocumentsByFolder = query({
  args: { folderId: v.id("folders") },
  handler: async (ctx, args): Promise<Doc<"documents">[]> => {
    const userId = await getOptionalAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("documents")
      .withIndex("by_userId_and_folderId", (q) =>
        q.eq("userId", userId).eq("folderId", args.folderId),
      )
      .order("desc")
      .take(200);
  },
});

/**
 * Upgrade an owned, legacy indexed source to the immutable identity contract
 * required by Audio Overview v2. The server computes the byte hash from the
 * authorized R2 object; this mutation revalidates ownership and object identity
 * before scheduling R2 metadata replacement and AI Search re-indexing.
 */
export const prepareAudioOverviewSourceRepair = mutation({
  args: {
    documentId: v.id("documents"),
    expectedR2Key: v.string(),
    contentHash: v.string(),
    sourceRevision: v.string(),
    orchestrationToken: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    requireAudioOverviewOrchestrationCredential(args.orchestrationToken);

    const document = await ctx.db.get(args.documentId);
    if (!document || document.userId !== userId) {
      throw new Error("Document not found");
    }
    if (document.r2Key !== args.expectedR2Key) {
      throw new Error(
        "Source changed while immutable identity was being prepared",
      );
    }

    const contentHash = args.contentHash.trim().toLowerCase();
    const sourceRevision = args.sourceRevision.trim();
    if (
      !SHA256_PATTERN.test(contentHash) ||
      sourceRevision !== `sha256:${contentHash}`
    ) {
      throw new Error("Invalid immutable source identity");
    }
    if (
      document.contentHash === contentHash &&
      document.sourceRevision === sourceRevision
    ) {
      return { repairing: document.status === "indexing" };
    }
    if (document.status !== "success")
      throw new Error("Source not found or not ready");

    await ctx.db.patch(document._id, {
      status: "indexing",
      failureReason: undefined,
      indexJobId: undefined,
      contentHash,
      sourceRevision,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.documentActions.updateDocumentAiSearchMetadata,
      {
        documentId: document._id,
        userId: document.userId,
        folderId: String(document.folderId),
        filename: document.filename,
        r2Key: document.r2Key,
        expectedJobId: undefined,
        repairAttempt: 0,
      },
    );
    return { repairing: true };
  },
});

export const updateDocumentFilename = internalMutation({
  args: {
    id: v.id("documents"),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { filename: args.filename });
  },
});

export const countsByFolder = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthUserId(ctx);
    if (!userId) return [] as Array<{ folderId: string; count: number }>;

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const counts = new Map<string, number>();
    for (const d of docs) {
      const key = d.folderId as unknown as string;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([folderId, count]) => ({
      folderId,
      count,
    }));
  },
});

export const updateDocumentStatus = internalMutation({
  args: {
    id: v.id("documents"),
    status: v.union(
      v.literal("processing"),
      v.literal("indexing"),
      v.literal("success"),
      v.literal("failed"),
    ),
    failureReason: v.optional(v.string()),
    indexJobId: v.optional(v.string()),
    r2Key: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    sourceRevision: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      status: args.status,
      failureReason: args.status !== "failed" ? undefined : args.failureReason,
    };
    if (args.indexJobId !== undefined) patch.indexJobId = args.indexJobId;
    if (args.r2Key !== undefined) patch.r2Key = args.r2Key;
    if (args.contentHash !== undefined) patch.contentHash = args.contentHash;
    if (args.sourceRevision !== undefined)
      patch.sourceRevision = args.sourceRevision;
    await ctx.db.patch(args.id, patch);
  },
});

export const assignDocumentIndexJob = internalMutation({
  args: {
    id: v.id("documents"),
    expectedIndexJobId: v.optional(v.string()),
    expectedFolderId: v.id("folders"),
    expectedR2Key: v.optional(v.string()),
    indexJobId: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (
      !doc ||
      doc.status !== "indexing" ||
      doc.indexJobId !== args.expectedIndexJobId ||
      doc.folderId !== args.expectedFolderId ||
      doc.r2Key !== args.expectedR2Key
    )
      return false;

    await ctx.db.patch(args.id, { indexJobId: args.indexJobId });
    return true;
  },
});

export const finalizeDocumentIndexing = internalMutation({
  args: {
    id: v.id("documents"),
    expectedIndexJobId: v.optional(v.string()),
    expectedFolderId: v.id("folders"),
    expectedR2Key: v.optional(v.string()),
    status: v.union(v.literal("success"), v.literal("failed")),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (
      !doc ||
      doc.status !== "indexing" ||
      doc.indexJobId !== args.expectedIndexJobId ||
      doc.folderId !== args.expectedFolderId ||
      doc.r2Key !== args.expectedR2Key
    )
      return false;

    await ctx.db.patch(args.id, {
      status: args.status,
      failureReason: args.status === "failed" ? args.failureReason : undefined,
    });
    return true;
  },
});

export const getDocument = internalQuery({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const enqueueFailedDocumentCleanup = internalMutation({
  args: {
    userId: v.string(),
    documentId: v.string(),
    retryAiSearch: v.boolean(),
    retryR2: v.boolean(),
    r2Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let r2Enqueued = false;
    let aiSearchEnqueued = false;

    if (args.retryR2 && args.r2Key) {
      await ctx.db.insert("pendingCleanup", {
        userId: args.userId,
        documentId: args.documentId,
        r2Key: args.r2Key,
        kind: "r2",
        attempts: 0,
      });
      r2Enqueued = true;
    }

    if (args.retryAiSearch) {
      await ctx.db.insert("pendingCleanup", {
        userId: args.userId,
        documentId: args.documentId,
        r2Key: args.r2Key,
        kind: "ai-search",
        attempts: 0,
      });
      aiSearchEnqueued = true;
    }

    return { r2Enqueued, aiSearchEnqueued };
  },
});

export const removeFailedDocument = internalMutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.status !== "failed") return;

    const folder = await ctx.db.get(doc.folderId);
    if (folder) {
      await ctx.db.patch(doc.folderId, {
        documentCount: Math.max(0, folder.documentCount - 1),
        updatedAt: Date.now(),
      });
    }

    await ctx.db.delete(args.id);
  },
});

export const deleteDocument = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.userId !== userId) {
      throw new Error("Document not found");
    }

    const { r2Enqueued, aiSearchEnqueued } = await enqueueDocumentCleanup(ctx, {
      userId,
      documentId: String(doc._id),
      status: doc.status,
      r2Key: doc.r2Key,
    });

    const folder = await ctx.db.get(doc.folderId);
    if (folder) {
      await ctx.db.patch(doc.folderId, {
        documentCount: Math.max(0, folder.documentCount - 1),
        updatedAt: Date.now(),
      });
    }

    if (doc.fileId) {
      try {
        await ctx.storage.delete(doc.fileId);
      } catch {
        // best-effort; blob may already be gone
      }
    }
    await ctx.db.delete(args.id);

    if (r2Enqueued || aiSearchEnqueued) {
      await ctx.scheduler.runAfter(
        0,
        internal.accountDeletion.drainPendingCleanup,
        { userId },
      );
    }
  },
});

export const moveDocument = mutation({
  args: {
    id: v.id("documents"),
    destinationFolderId: v.id("folders"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.userId !== userId) {
      throw new Error("Document not found");
    }

    if (doc.folderId === args.destinationFolderId) {
      throw new Error("Document is already in this folder");
    }

    const destFolder = await ctx.db.get(args.destinationFolderId);
    if (!destFolder || destFolder.userId !== userId) {
      throw new Error("Folder not found");
    }

    const srcFolder = await ctx.db.get(doc.folderId);

    const shouldReindex = doc.status === "success" || doc.status === "indexing";
    await ctx.db.patch(args.id, {
      folderId: args.destinationFolderId,
      ...(shouldReindex
        ? {
            status: "indexing" as const,
            failureReason: undefined,
            indexJobId: undefined,
          }
        : {}),
    });

    if (shouldReindex) {
      await ctx.scheduler.runAfter(
        0,
        internal.documentActions.updateDocumentAiSearchMetadata,
        {
          documentId: args.id,
          userId,
          folderId: String(args.destinationFolderId),
          filename: doc.filename,
          r2Key: doc.r2Key,
        },
      );
    }

    if (srcFolder) {
      await ctx.db.patch(doc.folderId, {
        documentCount: Math.max(0, srcFolder.documentCount - 1),
        updatedAt: Date.now(),
      });
    }

    await ctx.db.patch(args.destinationFolderId, {
      documentCount: destFolder.documentCount + 1,
      updatedAt: Date.now(),
    });
  },
});
