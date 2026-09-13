import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  hasLearnV2Access,
  requireLearnV2MutationAccess,
  requireLearnV2QueryAccess,
} from "./lib/learnV2Access";

const MAX_FOLDERS = 8,
  MAX_DOCUMENTS = 64,
  PAGE = 16,
  MAX_ENTRIES = 4096,
  MAX_DEPTH = 32;
const HASH = /^[a-f0-9]{64}$/i;
type Folder = Doc<"folders">;
type Document = Doc<"documents">;
type Manifest = Doc<"learnFolderSourceManifests">;
const cap = (o: { cursor: string | null; numItems: number }) => ({
  cursor: o.cursor,
  numItems: Math.min(PAGE, Math.max(1, Math.floor(o.numItems))),
});

const digest = async (value: string) =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
const folderRevision = (folder: Folder) =>
  digest(
    JSON.stringify({
      id: String(folder._id),
      parentId: folder.parentId ? String(folder.parentId) : null,
      name: folder.name,
      updatedAt: folder.updatedAt ?? folder._creationTime,
    }),
  );
function normalizedDocumentRevision(document: Document) {
  const contentHash = document.contentHash?.trim().toLowerCase() ?? "";
  const sourceRevision = document.sourceRevision?.trim() ?? "";
  return HASH.test(contentHash) && sourceRevision === `sha256:${contentHash}`
    ? { contentHash, sourceRevision }
    : null;
}

function state(document: Document): {
  availability: "available" | "unavailable";
  unavailableReason?:
    | "processing"
    | "failed"
    | "missing_object_key"
    | "invalid_content_hash"
    | "invalid_source_revision";
} {
  if (document.status === "processing" || document.status === "indexing")
    return { availability: "unavailable", unavailableReason: "processing" };
  if (document.status === "failed")
    return { availability: "unavailable", unavailableReason: "failed" };
  if (!document.r2Key?.trim())
    return {
      availability: "unavailable",
      unavailableReason: "missing_object_key",
    };
  const contentHash = document.contentHash?.trim().toLowerCase() ?? "";
  if (!HASH.test(contentHash))
    return {
      availability: "unavailable",
      unavailableReason: "invalid_content_hash",
    };
  if (document.sourceRevision?.trim() !== `sha256:${contentHash}`)
    return {
      availability: "unavailable",
      unavailableReason: "invalid_source_revision",
    };
  return { availability: "available" };
}

function manifestView(manifest: Manifest) {
  return {
    _id: manifest._id,
    learningVoidId: manifest.learningVoidId,
    blueprintRevisionId: manifest.blueprintRevisionId,
    status: manifest.status,
    coverage: manifest.coverage,
    recordRevision: manifest.recordRevision,
    entryCount: manifest.entryCount,
    availableCount: manifest.availableCount,
    unavailableCount: manifest.unavailableCount,
    createdAt: manifest.createdAt,
    frozenAt: manifest.frozenAt,
    failureReason: manifest.failureReason,
  };
}
async function voidFor(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  id: Id<"learningVoids">,
) {
  const learningVoid = await ctx.db.get(id);
  if (!learningVoid || learningVoid.userId !== userId)
    throw new Error("Learning Void not found");
  const root = await ctx.db.get(learningVoid.folderId);
  if (!root || root.userId !== userId)
    throw new Error("Learning Void folder not found");
  return { learningVoid, root };
}
async function inside(
  ctx: MutationCtx,
  userId: string,
  root: Id<"folders">,
  folderId: Id<"folders">,
) {
  let id: Id<"folders"> | undefined = folderId;
  for (let depth = 0; id && depth <= MAX_DEPTH; depth++) {
    if (id === root) return true;
    const row: Folder | null = await ctx.db.get(id);
    if (!row || row.userId !== userId) return false;
    id = row.parentId;
  }
  return false;
}
function fingerprint(a: {
  learningVoidId: Id<"learningVoids">;
  blueprintRevisionId: Id<"learnBlueprintRevisions">;
  expectedVoidRevision: number;
  expectedBlueprintRecordRevision: number;
  folderIds: Id<"folders">[];
  documentIds: Id<"documents">[];
}) {
  return JSON.stringify({
    ...a,
    learningVoidId: String(a.learningVoidId),
    blueprintRevisionId: String(a.blueprintRevisionId),
    folderIds: [...new Set(a.folderIds.map(String))].sort(),
    documentIds: [...new Set(a.documentIds.map(String))].sort(),
  });
}
async function addFolder(
  ctx: MutationCtx,
  manifest: Doc<"learnFolderSourceManifests">,
  folder: Folder,
  depth: number,
  scan: boolean,
) {
  const prior = await ctx.db
    .query("learnFolderSourceManifestFolders")
    .withIndex("by_userId_and_manifestId_and_folderId", (q) =>
      q
        .eq("userId", manifest.userId)
        .eq("manifestId", manifest._id)
        .eq("folderId", folder._id),
    )
    .unique();
  if (prior) {
    if (scan && prior.stage === "complete" && prior.documentCount === 0)
      await ctx.db.patch(prior._id, { stage: "children" });
    return (await ctx.db.get(prior._id)) ?? prior;
  }
  const current = await ctx.db.get(manifest._id);
  if (!current) throw new Error("Source manifest disappeared");
  const id = await ctx.db.insert("learnFolderSourceManifestFolders", {
    userId: manifest.userId,
    manifestId: manifest._id,
    folderId: folder._id,
    parentFolderId: folder.parentId,
    name: folder.name,
    folderRevision: await folderRevision(folder),
    depth,
    order: current.nextFolderOrder,
    stage: scan ? "children" : "complete",
    documentCount: 0,
  });
  await ctx.db.patch(manifest._id, {
    nextFolderOrder: current.nextFolderOrder + 1,
  });
  const result = await ctx.db.get(id);
  if (!result) throw new Error("Unable to stage folder");
  return result;
}
async function addDocument(
  ctx: MutationCtx,
  manifest: Doc<"learnFolderSourceManifests">,
  folder: Doc<"learnFolderSourceManifestFolders">,
  document: Document,
) {
  if (!folder.folderId)
    throw new Error("Document folder was deleted during source capture");
  const prior = await ctx.db
    .query("learnFolderSourceManifestEntries")
    .withIndex("by_userId_and_manifestId_and_documentId", (q) =>
      q
        .eq("userId", manifest.userId)
        .eq("manifestId", manifest._id)
        .eq("documentId", document._id),
    )
    .unique();
  if (prior) return;
  const current = await ctx.db.get(manifest._id);
  if (!current) throw new Error("Source manifest disappeared");
  if (current.entryCount >= MAX_ENTRIES)
    throw new Error("Folder source manifest exceeds the terminal entry limit");
  let identity = await ctx.db
    .query("learnSourceIdentities")
    .withIndex("by_userId_and_learningVoidId_and_folderDocumentId", (q) =>
      q
        .eq("userId", manifest.userId)
        .eq("learningVoidId", manifest.learningVoidId)
        .eq("folderDocumentId", document._id),
    )
    .unique();
  if (!identity) {
    const id = await ctx.db.insert("learnSourceIdentities", {
      userId: manifest.userId,
      learningVoidId: manifest.learningVoidId,
      origin: "folder_document",
      externalKey: `document:${document._id}`,
      folderDocumentId: document._id,
      title: document.filename,
    });
    identity = await ctx.db.get(id);
    if (!identity) throw new Error("Unable to create source identity");
  }
  const latest = await ctx.db
    .query("learnSourceSnapshots")
    .withIndex("by_userId_and_sourceIdentityId_and_revision", (q) =>
      q.eq("userId", manifest.userId).eq("sourceIdentityId", identity._id),
    )
    .order("desc")
    .first();
  const availability = state(document);
  const sourceRevision = normalizedDocumentRevision(document);
  const snapshotId = await ctx.db.insert("learnSourceSnapshots", {
    userId: manifest.userId,
    learningVoidId: manifest.learningVoidId,
    blueprintRevisionId: manifest.blueprintRevisionId,
    folderManifestId: manifest._id,
    sourceIdentityId: identity._id,
    revision: (latest?.revision ?? 0) + 1,
    status:
      availability.availability === "available" ? "candidate" : "unavailable",
    contentHash: sourceRevision?.contentHash,
    sourceRevision: sourceRevision?.sourceRevision,
    objectKey: document.r2Key?.trim() || undefined,
    folderId: folder.folderId,
    folderRevision: folder.folderRevision,
    filename: document.filename,
    createdAt: Date.now(),
  });
  await ctx.db.insert("learnFolderSourceManifestEntries", {
    userId: manifest.userId,
    manifestId: manifest._id,
    order: current.nextEntryOrder,
    documentId: document._id,
    folderId: folder.folderId,
    folderRevision: folder.folderRevision,
    sourceIdentityId: identity._id,
    sourceSnapshotId: snapshotId,
    contentHash: sourceRevision?.contentHash,
    documentRevision: sourceRevision?.sourceRevision,
    ...availability,
  });
  await ctx.db.patch(manifest._id, {
    nextEntryOrder: current.nextEntryOrder + 1,
    entryCount: current.entryCount + 1,
    availableCount:
      current.availableCount +
      (availability.availability === "available" ? 1 : 0),
    unavailableCount:
      current.unavailableCount +
      (availability.availability === "unavailable" ? 1 : 0),
    coverage:
      current.availableCount +
        (availability.availability === "available" ? 1 : 0) ===
      0
        ? "gap"
        : current.unavailableCount +
              (availability.availability === "unavailable" ? 1 : 0) ===
            0
          ? "complete"
          : "partial",
  });
}

async function refreshFolderForCapture(
  ctx: MutationCtx,
  manifest: Manifest,
  captured: Doc<"learnFolderSourceManifestFolders">,
) {
  if (!captured.folderId)
    throw new Error("Selected folder was deleted during source capture");
  const live = await ctx.db.get(captured.folderId);
  if (
    !live ||
    live.userId !== manifest.userId ||
    !(await inside(ctx, manifest.userId, manifest.rootFolderId, live._id))
  )
    throw new Error(
      "Selected folder changed or left the Learning Void root subtree",
    );
  const revision = await folderRevision(live);
  if (revision === captured.folderRevision)
    return { ...captured, folderId: captured.folderId };
  if (
    captured.stage !== "children" ||
    captured.childCursor !== undefined ||
    captured.documentCursor !== undefined ||
    captured.documentCount > 0
  )
    throw new Error("Selected folder changed during paged source capture");
  await ctx.db.patch(captured._id, {
    parentFolderId: live.parentId,
    name: live.name,
    folderRevision: revision,
  });
  return {
    ...captured,
    folderId: captured.folderId,
    parentFolderId: live.parentId,
    name: live.name,
    folderRevision: revision,
  };
}

export const freezeManifest = mutation({
  args: {
    learningVoidId: v.id("learningVoids"),
    blueprintRevisionId: v.id("learnBlueprintRevisions"),
    expectedBlueprintRecordRevision: v.number(),
    expectedVoidRevision: v.number(),
    folderIds: v.array(v.id("folders")),
    documentIds: v.array(v.id("documents")),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.expectedVoidRevision) ||
      !Number.isSafeInteger(args.expectedBlueprintRecordRevision) ||
      args.expectedVoidRevision < 1 ||
      args.expectedBlueprintRecordRevision < 1
    )
      throw new Error("Expected revisions must be safe positive integers");
    if (!args.idempotencyKey.trim() || args.idempotencyKey.length > 128)
      throw new Error("Invalid idempotency key");
    if (
      args.folderIds.length > MAX_FOLDERS ||
      args.documentIds.length > MAX_DOCUMENTS
    )
      throw new Error(
        "Folder source selection exceeds the bounded input limit",
      );
    const userId = await requireLearnV2MutationAccess(ctx),
      key = fingerprint(args);
    const replay = await ctx.db
      .query("learnFolderSourceManifests")
      .withIndex("by_userId_and_idempotencyKey", (q) =>
        q.eq("userId", userId).eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (replay) {
      if (replay.requestFingerprint !== key)
        throw new Error(
          "Idempotency key was already used for a different request",
        );
      await voidFor(ctx, userId, replay.learningVoidId);
      if (replay.status === "capturing")
        await ctx.scheduler.runAfter(
          0,
          internal.learnV2FolderManifests.continueCapture,
          { manifestId: replay._id },
        );
      return manifestView(replay);
    }
    const { learningVoid, root } = await voidFor(
      ctx,
      userId,
      args.learningVoidId,
    );
    if (learningVoid.revision !== args.expectedVoidRevision)
      throw new Error("Learning Void revision conflict");
    const blueprint = await ctx.db.get(args.blueprintRevisionId);
    if (
      !blueprint ||
      blueprint.userId !== userId ||
      blueprint.learningVoidId !== learningVoid._id
    )
      throw new Error("Blueprint revision not found");
    if (blueprint.recordRevision !== args.expectedBlueprintRecordRevision)
      throw new Error("Blueprint revision conflict");
    if (blueprint.status !== "draft" && blueprint.status !== "source_review")
      throw new Error("Blueprint revision is immutable");
    const folders = [
        ...new Set(args.folderIds.map(String)),
      ] as unknown as Id<"folders">[],
      documents = [
        ...new Set(args.documentIds.map(String)),
      ] as unknown as Id<"documents">[],
      folderRows: Folder[] = [];
    for (const id of folders) {
      const row = await ctx.db.get(id);
      if (!row || row.userId !== userId)
        throw new Error("Selected folder not found");
      if (!(await inside(ctx, userId, root._id, id)))
        throw new Error(
          "Selected folder is outside the Learning Void root subtree",
        );
      folderRows.push(row);
    }
    for (const id of documents) {
      const row = await ctx.db.get(id);
      if (!row || row.userId !== userId)
        throw new Error("Selected document not found");
      if (!(await inside(ctx, userId, root._id, row.folderId)))
        throw new Error(
          "Selected document is outside the Learning Void root subtree",
        );
    }
    const now = Date.now(),
      id = await ctx.db.insert("learnFolderSourceManifests", {
        userId,
        learningVoidId: learningVoid._id,
        blueprintRevisionId: blueprint._id,
        rootFolderId: root._id,
        expectedVoidRevision: args.expectedVoidRevision,
        expectedBlueprintRecordRevision: args.expectedBlueprintRecordRevision,
        recordRevision: 1,
        status: "capturing",
        coverage: "empty",
        idempotencyKey: args.idempotencyKey,
        requestFingerprint: key,
        explicitDocumentIds: documents,
        explicitDocumentCursor: 0,
        nextFolderOrder: 0,
        nextEntryOrder: 0,
        entryCount: 0,
        availableCount: 0,
        unavailableCount: 0,
        createdAt: now,
      });
    const manifest = await ctx.db.get(id);
    if (!manifest) throw new Error("Unable to create source manifest");
    for (const folder of folderRows.sort((a, b) =>
      String(a._id).localeCompare(String(b._id)),
    ))
      await addFolder(ctx, manifest, folder, 0, true);
    if (!folders.length && !documents.length)
      await ctx.db.patch(id, {
        status: "frozen",
        recordRevision: 2,
        frozenAt: now,
      });
    else
      await ctx.scheduler.runAfter(
        0,
        internal.learnV2FolderManifests.continueCapture,
        { manifestId: id },
      );
    const created = await ctx.db.get(id);
    if (!created) throw new Error("Unable to read source manifest");
    return manifestView(created);
  },
});

export const continueCapture = internalMutation({
  args: { manifestId: v.id("learnFolderSourceManifests") },
  handler: async (ctx, { manifestId }) => {
    const manifest = await ctx.db.get(manifestId);
    if (!manifest || manifest.status !== "capturing") return { done: true };
    if (!(await hasLearnV2Access(ctx, manifest.userId)))
      return { done: true, paused: true };
    try {
      if (
        manifest.explicitDocumentCursor < manifest.explicitDocumentIds.length
      ) {
        const document = await ctx.db.get(
          manifest.explicitDocumentIds[manifest.explicitDocumentCursor]!,
        );
        if (
          !document ||
          document.userId !== manifest.userId ||
          !(await inside(
            ctx,
            manifest.userId,
            manifest.rootFolderId,
            document.folderId,
          ))
        )
          throw new Error(
            "Selected document changed or left the Learning Void root subtree",
          );
        const actualFolder = await ctx.db.get(document.folderId);
        if (!actualFolder || actualFolder.userId !== manifest.userId)
          throw new Error("Selected document folder is unavailable");
        const folder = await addFolder(ctx, manifest, actualFolder, 0, false);
        await addDocument(ctx, manifest, folder, document);
        await ctx.db.patch(manifest._id, {
          explicitDocumentCursor: manifest.explicitDocumentCursor + 1,
        });
      } else {
        const children = await ctx.db
          .query("learnFolderSourceManifestFolders")
          .withIndex("by_userId_and_manifestId_and_stage_and_order", (q) =>
            q
              .eq("userId", manifest.userId)
              .eq("manifestId", manifest._id)
              .eq("stage", "children"),
          )
          .first();
        if (children) {
          const currentFolder = await refreshFolderForCapture(
            ctx,
            manifest,
            children,
          );
          const page = await ctx.db
            .query("folders")
            .withIndex("by_userId_and_parentId", (q) =>
              q
                .eq("userId", manifest.userId)
                .eq("parentId", currentFolder.folderId),
            )
            .paginate({
              cursor: currentFolder.childCursor ?? null,
              numItems: PAGE,
            });
          for (const child of page.page) {
            if (currentFolder.depth + 1 > MAX_DEPTH)
              throw new Error("Folder source scope exceeds the maximum depth");
            await addFolder(
              ctx,
              manifest,
              child,
              currentFolder.depth + 1,
              true,
            );
          }
          await ctx.db.patch(
            currentFolder._id,
            page.isDone
              ? { stage: "documents", childCursor: undefined }
              : { childCursor: page.continueCursor },
          );
        } else {
          const folder = await ctx.db
            .query("learnFolderSourceManifestFolders")
            .withIndex("by_userId_and_manifestId_and_stage_and_order", (q) =>
              q
                .eq("userId", manifest.userId)
                .eq("manifestId", manifest._id)
                .eq("stage", "documents"),
            )
            .first();
          if (folder) {
            const currentFolder = await refreshFolderForCapture(
              ctx,
              manifest,
              folder,
            );
            const page = await ctx.db
              .query("documents")
              .withIndex("by_userId_and_folderId", (q) =>
                q
                  .eq("userId", manifest.userId)
                  .eq("folderId", currentFolder.folderId),
              )
              .paginate({
                cursor: currentFolder.documentCursor ?? null,
                numItems: PAGE,
              });
            for (const document of page.page)
              await addDocument(ctx, manifest, currentFolder, document);
            await ctx.db.patch(
              currentFolder._id,
              page.isDone
                ? {
                    stage: "complete",
                    documentCursor: undefined,
                    documentCount:
                      currentFolder.documentCount + page.page.length,
                  }
                : {
                    documentCursor: page.continueCursor,
                    documentCount:
                      currentFolder.documentCount + page.page.length,
                  },
            );
          } else {
            const { learningVoid } = await voidFor(
              ctx,
              manifest.userId,
              manifest.learningVoidId,
            );
            const blueprint = await ctx.db.get(manifest.blueprintRevisionId);
            if (
              learningVoid.revision !== manifest.expectedVoidRevision ||
              !blueprint ||
              blueprint.userId !== manifest.userId ||
              blueprint.learningVoidId !== manifest.learningVoidId ||
              blueprint.recordRevision !==
                manifest.expectedBlueprintRecordRevision ||
              (blueprint.status !== "draft" &&
                blueprint.status !== "source_review")
            )
              throw new Error(
                "Learning Void or Blueprint changed during source capture",
              );
            await ctx.db.patch(manifest._id, {
              status: "frozen",
              recordRevision: manifest.recordRevision + 1,
              frozenAt: Date.now(),
            });
            return { done: true };
          }
        }
      }
    } catch (error) {
      await ctx.db.patch(manifest._id, {
        status: "failed",
        recordRevision: manifest.recordRevision + 1,
        failureReason: (error instanceof Error
          ? error.message
          : "Source capture failed"
        ).slice(0, 500),
      });
      return { done: true };
    }
    await ctx.scheduler.runAfter(
      0,
      internal.learnV2FolderManifests.continueCapture,
      { manifestId },
    );
    return { done: false };
  },
});

async function guarded(ctx: QueryCtx, id: Id<"learnFolderSourceManifests">) {
  const userId = await requireLearnV2QueryAccess(ctx),
    manifest = await ctx.db.get(id);
  if (!manifest || manifest.userId !== userId) return null;
  try {
    await voidFor(ctx, userId, manifest.learningVoidId);
  } catch {
    return null;
  }
  return manifest;
}
export const getManifest = query({
  args: { manifestId: v.id("learnFolderSourceManifests") },
  handler: async (ctx, a) => {
    const manifest = await guarded(ctx, a.manifestId);
    return manifest ? manifestView(manifest) : null;
  },
});
export const getLatestManifestForBlueprint = query({
  args: { blueprintRevisionId: v.id("learnBlueprintRevisions") },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx);
    const blueprint = await ctx.db.get(args.blueprintRevisionId);
    if (!blueprint || blueprint.userId !== userId) return null;
    try {
      await voidFor(ctx, userId, blueprint.learningVoidId);
    } catch {
      return null;
    }
    const manifest = await ctx.db
      .query("learnFolderSourceManifests")
      .withIndex("by_userId_and_blueprintRevisionId", (q) =>
        q.eq("userId", userId).eq("blueprintRevisionId", blueprint._id),
      )
      .order("desc")
      .first();
    return manifest ? manifestView(manifest) : null;
  },
});
export const listManifestFolders = query({
  args: {
    manifestId: v.id("learnFolderSourceManifests"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, a) => {
    const m = await guarded(ctx, a.manifestId);
    if (!m) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("learnFolderSourceManifestFolders")
      .withIndex("by_userId_and_manifestId_and_order", (q) =>
        q.eq("userId", m.userId).eq("manifestId", m._id),
      )
      .paginate(cap(a.paginationOpts));
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async ({
          childCursor: _childCursor,
          documentCursor: _documentCursor,
          stage: _stage,
          ...folder
        }) => {
          if (!folder.folderId || await ctx.db.get(folder.folderId)) return folder;
          return {
            ...folder,
            folderId: undefined,
            parentFolderId: undefined,
            name: undefined,
          };
        }),
      ),
    };
  },
});
export const listManifestEntries = query({
  args: {
    manifestId: v.id("learnFolderSourceManifests"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, a) => {
    const m = await guarded(ctx, a.manifestId);
    if (!m) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("learnFolderSourceManifestEntries")
      .withIndex("by_userId_and_manifestId_and_order", (q) =>
        q.eq("userId", m.userId).eq("manifestId", m._id),
      )
      .paginate(cap(a.paginationOpts));
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (entry) => {
          if (!entry.documentId || await ctx.db.get(entry.documentId))
            return entry;
          return {
            ...entry,
            documentId: undefined,
            folderId: undefined,
            availability: "unavailable" as const,
            unavailableReason: "source_deleted" as const,
          };
        }),
      ),
    };
  },
});
