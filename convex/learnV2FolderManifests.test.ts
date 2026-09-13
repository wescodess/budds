/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const owner = {
  tokenIdentifier: "https://auth.example.com|folder-manifest-owner",
  name: "Manifest Owner",
};
const other = {
  tokenIdentifier: "https://auth.example.com|folder-manifest-other",
  name: "Manifest Other",
};
const hash = (char: string) => char.repeat(64);

async function ready() {
  process.env.LEARN_V2_ENABLED = "true";
  const t = convexTest(schema, modules);
  const asOwner = t.withIdentity(owner);
  const asOther = t.withIdentity(other);
  await asOwner.mutation(api.users.upsertUser, {});
  await asOther.mutation(api.users.upsertUser, {});
  await t.mutation(internal.learnV2Access.setCohortEntitlement, {
    tokenIdentifier: owner.tokenIdentifier,
    enabled: true,
  });
  await t.mutation(internal.learnV2Access.setCohortEntitlement, {
    tokenIdentifier: other.tokenIdentifier,
    enabled: true,
  });
  const root = await asOwner.mutation(api.folders.createFolder, {
    name: "Root",
  });
  const voidRow = await asOwner.mutation(
    api.learnV2Lifecycle.createLearningVoid,
    { folderId: root, title: "Scope", idempotencyKey: "void" },
  );
  const blueprint = await asOwner.mutation(
    api.learnV2Lifecycle.createBlueprintDraft,
    {
      learningVoidId: voidRow!._id,
      expectedVoidRevision: 1,
      idempotencyKey: "blueprint",
    },
  );
  return {
    t,
    asOwner,
    asOther,
    root,
    voidRow: voidRow!,
    blueprint: blueprint!,
  };
}

async function document(
  t: Awaited<ReturnType<typeof ready>>["t"],
  folderId: any,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("documents", {
      userId: owner.tokenIdentifier,
      folderId,
      filename: name,
      status: "success",
      fileSize: 1,
      r2Key: `tenant/${name}`,
      contentHash: hash("a"),
      sourceRevision: `sha256:${hash("a")}`,
      ...overrides,
    }),
  );
}

describe("Learn V2 folder source manifests", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  test("freezes an empty selected folder as an explicit zero-document gap", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    const empty = await asOwner.mutation(api.folders.createSubfolder, {
      parentId: root,
      name: "Empty",
    });
    const manifest = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [empty],
        documentIds: [],
        idempotencyKey: "empty",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const settled = await asOwner.query(
      api.learnV2FolderManifests.getManifest,
      { manifestId: manifest!._id },
    );
    expect(settled).toMatchObject({
      entryCount: 0,
      availableCount: 0,
      unavailableCount: 0,
      status: "frozen",
    });
    const folders = await asOwner.query(
      api.learnV2FolderManifests.listManifestFolders,
      {
        manifestId: manifest!._id,
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    expect(folders.page).toMatchObject([{ folderId: empty, documentCount: 0 }]);
    expect(folders.page[0]).not.toHaveProperty("stage");
    expect(folders.page[0]).not.toHaveProperty("childCursor");
    expect(folders.page[0]).not.toHaveProperty("documentCursor");
  });

  test("freezes root/child/grandchild sources with real folder identities and explicit availability gaps", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    const child = await asOwner.mutation(api.folders.createSubfolder, {
      parentId: root,
      name: "Child",
    });
    const grandchild = await asOwner.mutation(api.folders.createSubfolder, {
      parentId: child,
      name: "Grandchild",
    });
    const rootDoc = await document(t, root, "root.pdf");
    const childDoc = await document(t, child, "child.pdf");
    const failedDoc = await document(t, grandchild, "failed.pdf", {
      status: "failed",
      r2Key: undefined,
    });
    const frozen = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [root],
        documentIds: [],
        idempotencyKey: "freeze-root",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const settled = await asOwner.query(
      api.learnV2FolderManifests.getManifest,
      { manifestId: frozen!._id },
    );
    expect(settled).toMatchObject({
      entryCount: 3,
      availableCount: 2,
      unavailableCount: 1,
      status: "frozen",
    });
    const entries = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: frozen!._id,
        paginationOpts: { cursor: null, numItems: 20 },
      },
    );
    expect(
      entries.page.map((row: any) => [
        row.documentId,
        row.folderId,
        row.availability,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [rootDoc, root, "available"],
        [childDoc, child, "available"],
        [failedDoc, grandchild, "unavailable"],
      ]),
    );
    expect(entries.page.map((row: any) => row.order)).toEqual([0, 1, 2]);
    expect(
      entries.page.every((row: any) =>
        /^sha256:[a-f0-9]{64}$/.test(row.folderRevision),
      ),
    ).toBe(true);
    const availableEntry = entries.page.find(
      (row: any) => row.documentId === rootDoc,
    )!;
    expect(availableEntry).toMatchObject({
      contentHash: hash("a"),
      documentRevision: `sha256:${hash("a")}`,
    });
    const snapshot = await t.run((ctx) =>
      ctx.db.get(availableEntry.sourceSnapshotId),
    );
    expect(snapshot).toMatchObject({
      blueprintRevisionId: blueprint._id,
      folderManifestId: frozen!._id,
      folderId: root,
      folderRevision: availableEntry.folderRevision,
      contentHash: hash("a"),
      sourceRevision: `sha256:${hash("a")}`,
    });
  });

  test("rejects outside-root and other-owner selection, and replays only an identical request", async () => {
    const { t, asOwner, asOther, root, voidRow, blueprint } = await ready();
    const outside = await asOwner.mutation(api.folders.createFolder, {
      name: "Outside",
    });
    const insideDoc = await document(t, root, "inside.pdf");
    const outsideDoc = await document(t, outside, "outside.pdf");
    const base = {
      learningVoidId: voidRow._id,
      blueprintRevisionId: blueprint._id,
      expectedBlueprintRecordRevision: 1,
      expectedVoidRevision: 2,
    };
    await expect(
      asOwner.mutation(api.learnV2FolderManifests.freezeManifest, {
        ...base,
        folderIds: [outside],
        documentIds: [],
        idempotencyKey: "outside-folder",
      }),
    ).rejects.toThrow(/root subtree/);
    await expect(
      asOwner.mutation(api.learnV2FolderManifests.freezeManifest, {
        ...base,
        folderIds: [],
        documentIds: [outsideDoc],
        idempotencyKey: "outside-document",
      }),
    ).rejects.toThrow(/root subtree/);
    const first = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        ...base,
        folderIds: [],
        documentIds: [insideDoc],
        idempotencyKey: "same-key",
      },
    );
    const replay = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        ...base,
        folderIds: [],
        documentIds: [insideDoc],
        idempotencyKey: "same-key",
      },
    );
    expect(replay?._id).toBe(first?._id);
    expect(first).not.toHaveProperty("requestFingerprint");
    expect(first).not.toHaveProperty("idempotencyKey");
    expect(first).not.toHaveProperty("explicitDocumentIds");
    expect(
      await asOwner.query(
        api.learnV2FolderManifests.getLatestManifestForBlueprint,
        { blueprintRevisionId: blueprint._id },
      ),
    ).toMatchObject({ _id: first!._id });
    await expect(
      asOwner.mutation(api.learnV2FolderManifests.freezeManifest, {
        ...base,
        folderIds: [root],
        documentIds: [],
        idempotencyKey: "same-key",
      }),
    ).rejects.toThrow(/different request/);
    await expect(
      asOther.query(api.learnV2FolderManifests.getManifest, {
        manifestId: first!._id,
      }),
    ).resolves.toBeNull();

    const otherRoot = await asOther.mutation(api.folders.createFolder, {
      name: "Other root",
    });
    await expect(
      asOwner.mutation(api.learnV2FolderManifests.freezeManifest, {
        ...base,
        folderIds: [otherRoot],
        documentIds: [],
        idempotencyKey: "other-owner-folder",
      }),
    ).rejects.toThrow(/Selected folder not found/);
  });

  test("keeps a frozen document folder identity after a move while a new freeze sees current identity", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    const before = await asOwner.mutation(api.folders.createSubfolder, {
      parentId: root,
      name: "Before",
    });
    const after = await asOwner.mutation(api.folders.createSubfolder, {
      parentId: root,
      name: "After",
    });
    const doc = await document(t, before, "move.pdf");
    const args = {
      learningVoidId: voidRow._id,
      blueprintRevisionId: blueprint._id,
      expectedBlueprintRecordRevision: 1,
      expectedVoidRevision: 2,
      folderIds: [],
      documentIds: [doc],
    };
    const first = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      { ...args, idempotencyKey: "before-move" },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await asOwner.mutation(api.documents.moveDocument, {
      id: doc,
      destinationFolderId: after,
    });
    await t.run((ctx) =>
      ctx.db.patch(doc, {
        status: "success",
        r2Key: "tenant/move.pdf",
        contentHash: hash("c"),
        sourceRevision: `sha256:${hash("c")}`,
      }),
    );
    const second = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      { ...args, idempotencyKey: "after-move" },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const firstRows = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: first!._id,
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const secondRows = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: second!._id,
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    expect(
      firstRows.page.find((row: any) => row.documentId === doc),
    ).toMatchObject({ folderId: before });
    expect(
      secondRows.page.find((row: any) => row.documentId === doc),
    ).toMatchObject({ folderId: after });
  });
  test("captures explicit documents without widening and completes more than one page", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    const selected = await document(t, root, "selected.pdf");
    const sibling = await document(t, root, "sibling.pdf");
    const explicit = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [],
        documentIds: [selected],
        idempotencyKey: "one-only",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const explicitRows = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: explicit!._id,
        paginationOpts: { cursor: null, numItems: 20 },
      },
    );
    expect(explicitRows.page.map((row: any) => row.documentId)).toEqual([
      selected,
    ]);
    expect(explicitRows.page.map((row: any) => row.documentId)).not.toContain(
      sibling,
    );
    for (let i = 0; i < 17; i++) await document(t, root, `large-${i}.pdf`);
    const large = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [root],
        documentIds: [],
        idempotencyKey: "large-pages",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const settled = await asOwner.query(
      api.learnV2FolderManifests.getManifest,
      { manifestId: large!._id },
    );
    const rows = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: large!._id,
        paginationOpts: { cursor: null, numItems: 100 },
      },
    );
    const nextRows = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: large!._id,
        paginationOpts: { cursor: rows.continueCursor, numItems: 100 },
      },
    );
    expect(settled).toMatchObject({ status: "frozen", entryCount: 19 });
    expect(
      [...rows.page, ...nextRows.page].map((row: any) => row.order),
    ).toEqual([...Array(19).keys()]);
  });

  test("captures two authorized subtrees without widening to their parent or sibling subtree", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    const alpha = await asOwner.mutation(api.folders.createSubfolder, {
      parentId: root,
      name: "Alpha",
    });
    const beta = await asOwner.mutation(api.folders.createSubfolder, {
      parentId: root,
      name: "Beta",
    });
    const omitted = await asOwner.mutation(api.folders.createSubfolder, {
      parentId: root,
      name: "Omitted",
    });
    const alphaDoc = await document(t, alpha, "alpha.pdf");
    const betaDoc = await document(t, beta, "beta.pdf");
    const rootDoc = await document(t, root, "root-omitted.pdf");
    const omittedDoc = await document(t, omitted, "subtree-omitted.pdf");

    const manifest = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [alpha, beta],
        documentIds: [alphaDoc],
        idempotencyKey: "two-subtrees",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const entries = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: manifest!._id,
        paginationOpts: { cursor: null, numItems: 16 },
      },
    );
    expect(entries.page.map((row: any) => row.documentId).sort()).toEqual(
      [alphaDoc, betaDoc].sort(),
    );
    expect(entries.page.map((row: any) => row.documentId)).not.toContain(
      rootDoc,
    );
    expect(entries.page.map((row: any) => row.documentId)).not.toContain(
      omittedDoc,
    );
    expect(await t.run((ctx) => ctx.db.query("courses").collect())).toEqual([]);
  });

  test("pages a large descendant-folder frontier without losing folders or documents", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    const documentIds = [];
    for (let index = 0; index < 17; index++) {
      const child = await asOwner.mutation(api.folders.createSubfolder, {
        parentId: root,
        name: `Child ${index.toString().padStart(2, "0")}`,
      });
      documentIds.push(await document(t, child, `child-${index}.pdf`));
    }
    const manifest = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [root],
        documentIds: [],
        idempotencyKey: "large-folder-frontier",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const manifestRow = await asOwner.query(
      api.learnV2FolderManifests.getManifest,
      { manifestId: manifest!._id },
    );
    expect(manifestRow).toMatchObject({
      status: "frozen",
      coverage: "complete",
      entryCount: 17,
    });
    const firstFolders = await asOwner.query(
      api.learnV2FolderManifests.listManifestFolders,
      {
        manifestId: manifest!._id,
        paginationOpts: { cursor: null, numItems: 1_000 },
      },
    );
    const secondFolders = await asOwner.query(
      api.learnV2FolderManifests.listManifestFolders,
      {
        manifestId: manifest!._id,
        paginationOpts: {
          cursor: firstFolders.continueCursor,
          numItems: 1_000,
        },
      },
    );
    const folders = [...firstFolders.page, ...secondFolders.page];
    expect(folders).toHaveLength(18);
    expect(folders.map((row: any) => row.order)).toEqual([...Array(18).keys()]);

    const firstEntries = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: manifest!._id,
        paginationOpts: { cursor: null, numItems: 1_000 },
      },
    );
    const secondEntries = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: manifest!._id,
        paginationOpts: {
          cursor: firstEntries.continueCursor,
          numItems: 1_000,
        },
      },
    );
    expect(
      [...firstEntries.page, ...secondEntries.page]
        .map((row: any) => row.documentId)
        .sort(),
    ).toEqual(documentIds.sort());
  });

  test("records every invalid document as an explicit unavailable gap", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    const ids = [
      await document(t, root, "processing.pdf", { status: "indexing" }),
      await document(t, root, "failed.pdf", { status: "failed" }),
      await document(t, root, "missing-key.pdf", { r2Key: " " }),
      await document(t, root, "invalid-hash.pdf", {
        contentHash: "not-a-hash",
      }),
      await document(t, root, "invalid-revision.pdf", {
        sourceRevision: `sha256:${hash("b")}`,
      }),
    ];
    const manifest = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [root],
        documentIds: [],
        idempotencyKey: "invalid-sources",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const settled = await asOwner.query(
      api.learnV2FolderManifests.getManifest,
      { manifestId: manifest!._id },
    );
    expect(settled).toMatchObject({
      status: "frozen",
      coverage: "gap",
      entryCount: ids.length,
      availableCount: 0,
      unavailableCount: ids.length,
    });
    const entries = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: manifest!._id,
        paginationOpts: { cursor: null, numItems: 16 },
      },
    );
    expect(
      entries.page.map((row: any) => row.unavailableReason).sort(),
    ).toEqual([
      "failed",
      "invalid_content_hash",
      "invalid_source_revision",
      "missing_object_key",
      "processing",
    ]);
  });

  test("fails closed on stale revisions, immutable blueprints, and mid-capture drift", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    const base = {
      learningVoidId: voidRow._id,
      blueprintRevisionId: blueprint._id,
      folderIds: [root],
      documentIds: [],
    };
    await expect(
      asOwner.mutation(api.learnV2FolderManifests.freezeManifest, {
        ...base,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 1,
        idempotencyKey: "stale-void",
      }),
    ).rejects.toThrow(/Learning Void revision conflict/);
    await expect(
      asOwner.mutation(api.learnV2FolderManifests.freezeManifest, {
        ...base,
        expectedBlueprintRecordRevision: 2,
        expectedVoidRevision: 2,
        idempotencyKey: "stale-blueprint",
      }),
    ).rejects.toThrow(/Blueprint revision conflict/);

    const manifest = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        ...base,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        idempotencyKey: "drift",
      },
    );
    await t.run((ctx) => ctx.db.patch(blueprint._id, { recordRevision: 2 }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await asOwner.query(api.learnV2FolderManifests.getManifest, {
        manifestId: manifest!._id,
      }),
    ).toMatchObject({
      status: "failed",
      recordRevision: 2,
      failureReason: expect.stringMatching(/changed during source capture/),
    });

    await t.run((ctx) =>
      ctx.db.patch(blueprint._id, { recordRevision: 3, status: "map_review" }),
    );
    await expect(
      asOwner.mutation(api.learnV2FolderManifests.freezeManifest, {
        ...base,
        expectedBlueprintRecordRevision: 3,
        expectedVoidRevision: 2,
        idempotencyKey: "immutable-blueprint",
      }),
    ).rejects.toThrow(/immutable/);
  });

  test("is exact-once under duplicate and stale continuation delivery and caps list pages", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    const selected = await document(t, root, "once.pdf");
    const manifest = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [],
        documentIds: [selected],
        idempotencyKey: "duplicate-continuation",
      },
    );
    await t.mutation(internal.learnV2FolderManifests.continueCapture, {
      manifestId: manifest!._id,
    });
    await t.mutation(internal.learnV2FolderManifests.continueCapture, {
      manifestId: manifest!._id,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.mutation(internal.learnV2FolderManifests.continueCapture, {
      manifestId: manifest!._id,
    });
    const entries = await t.run((ctx) =>
      ctx.db
        .query("learnFolderSourceManifestEntries")
        .withIndex("by_userId_and_manifestId_and_order", (q) =>
          q.eq("userId", owner.tokenIdentifier).eq("manifestId", manifest!._id),
        )
        .collect(),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ documentId: selected, order: 0 });

    for (let index = 0; index < 17; index++)
      await document(t, root, `cap-${index}.pdf`);
    const paged = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [root],
        documentIds: [],
        idempotencyKey: "page-cap",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const firstPage = await asOwner.query(
      api.learnV2FolderManifests.listManifestEntries,
      {
        manifestId: paged!._id,
        paginationOpts: { cursor: null, numItems: 1_000 },
      },
    );
    expect(firstPage.page).toHaveLength(16);
    expect(firstPage.isDone).toBe(false);
  });

  test("denies manifest commands when the server-side V2 entitlement is removed", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    await t.mutation(internal.learnV2Access.setCohortEntitlement, {
      tokenIdentifier: owner.tokenIdentifier,
      enabled: false,
    });
    await expect(
      asOwner.mutation(api.learnV2FolderManifests.freezeManifest, {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [root],
        documentIds: [],
        idempotencyKey: "gate-denied",
      }),
    ).rejects.toThrow(/access denied/);
  });

  test("makes a deleted root unreadable and removes its manifest foundation in bounded cleanup", async () => {
    const { t, asOwner, root, voidRow, blueprint } = await ready();
    await document(t, root, "deleted-root.pdf", {
      status: "failed",
      r2Key: undefined,
    });
    const manifest = await asOwner.mutation(
      api.learnV2FolderManifests.freezeManifest,
      {
        learningVoidId: voidRow._id,
        blueprintRevisionId: blueprint._id,
        expectedBlueprintRecordRevision: 1,
        expectedVoidRevision: 2,
        folderIds: [root],
        documentIds: [],
        idempotencyKey: "deleted-root",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const persisted = await t.run(async (ctx) => {
      const entry = await ctx.db
        .query("learnFolderSourceManifestEntries")
        .withIndex("by_userId_and_manifestId_and_order", (q) =>
          q.eq("userId", owner.tokenIdentifier).eq("manifestId", manifest!._id),
        )
        .first();
      return {
        entryId: entry!._id,
        snapshotId: entry!.sourceSnapshotId,
        identityId: entry!.sourceIdentityId,
      };
    });

    await asOwner.mutation(api.folders.deleteFolder, { id: root });
    await expect(
      asOwner.query(api.learnV2FolderManifests.getManifest, {
        manifestId: manifest!._id,
      }),
    ).resolves.toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(manifest!._id))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(persisted.entryId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(persisted.snapshotId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(persisted.identityId))).toBeNull();
  });
});
