/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const TEST_IDENTITY = {
  tokenIdentifier: "https://auth.example.com|user_123",
  name: "Test User",
  email: "test@example.com",
};

const OTHER_IDENTITY = {
  tokenIdentifier: "https://auth.example.com|user_456",
  name: "Other User",
  email: "other@example.com",
};

describe("documents.generateUploadUrl", () => {
  it("[P0] should reject unauthenticated user", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.documents.generateUploadUrl, {}),
    ).rejects.toThrow();
  });

  it("[P0] should return URL string for authenticated user", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const url = await asUser.mutation(api.documents.generateUploadUrl, {});
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });
});

describe("documents.createDocument", () => {
  it("[P0] should create document with correct fields and status processing", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Test Folder",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["test pdf content"], { type: "application/pdf" }),
      );
    });

    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "lecture-notes.pdf",
      fileId: storageId,
      fileSize: 2048,
    });

    expect(docId).toBeDefined();

    const docs = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId,
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].filename).toBe("lecture-notes.pdf");
    expect(docs[0].status).toBe("processing");
    expect(docs[0].fileSize).toBeGreaterThan(0);
    expect(docs[0].userId).toBe(TEST_IDENTITY.tokenIdentifier);
    expect(docs[0].folderId).toBe(folderId);
  });

  it("[P0] should reject unauthenticated user", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Test Folder",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["test pdf"], { type: "application/pdf" }),
      );
    });

    await expect(
      t.mutation(api.documents.createDocument, {
        folderId,
        filename: "test.pdf",
        fileId: storageId,
        fileSize: 1024,
      }),
    ).rejects.toThrow();
  });

  it("[P0] should reject if folder does not belong to user", async () => {
    const t = convexTest(schema, modules);
    const asUser1 = t.withIdentity(TEST_IDENTITY);
    const asUser2 = t.withIdentity(OTHER_IDENTITY);

    const folderId = await asUser1.mutation(api.folders.createFolder, {
      name: "User1 Folder",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["test pdf"], { type: "application/pdf" }),
      );
    });

    await expect(
      asUser2.mutation(api.documents.createDocument, {
        folderId,
        filename: "intruder.pdf",
        fileId: storageId,
        fileSize: 1024,
      }),
    ).rejects.toThrow();
  });

  it("[P0] should increment folder documentCount", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Test Folder",
    });
    const folderBefore = await asUser.query(api.folders.getFolder, {
      id: folderId,
    });
    expect(folderBefore!.documentCount).toBe(0);

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf content"], { type: "application/pdf" }),
      );
    });

    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "test.pdf",
      fileId: storageId,
      fileSize: 1024,
    });

    const folderAfter = await asUser.query(api.folders.getFolder, {
      id: folderId,
    });
    expect(folderAfter!.documentCount).toBe(1);
  });

  it("[P1] should update folder updatedAt timestamp", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Test Folder",
    });
    const folderBefore = await asUser.query(api.folders.getFolder, {
      id: folderId,
    });

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf content"], { type: "application/pdf" }),
      );
    });

    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "test.pdf",
      fileId: storageId,
      fileSize: 1024,
    });

    const folderAfter = await asUser.query(api.folders.getFolder, {
      id: folderId,
    });
    expect(folderAfter!.updatedAt).toBeGreaterThanOrEqual(
      folderBefore!.updatedAt!,
    );
  });
});

describe("documents.prepareAudioOverviewSourceRepair", () => {
  beforeEach(() => {
    process.env.AUDIO_OVERVIEW_WORKER_TOKEN =
      "server-orchestration-token-at-least-32-characters";
  });

  afterEach(() => {
    delete process.env.AUDIO_OVERVIEW_WORKER_TOKEN;
  });

  it("[P0] schedules an owned legacy source for immutable-identity re-indexing", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Legacy sources",
    });
    const documentId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        userId: TEST_IDENTITY.tokenIdentifier,
        folderId,
        filename: "legacy.pdf",
        status: "success",
        fileSize: 2048,
        mimeType: "application/pdf",
        r2Key: "owner/folder/legacy.pdf",
      }),
    );
    const contentHash = "a".repeat(64);

    await expect(
      asUser.mutation(api.documents.prepareAudioOverviewSourceRepair, {
        documentId,
        expectedR2Key: "owner/folder/legacy.pdf",
        contentHash,
        sourceRevision: `sha256:${contentHash}`,
        orchestrationToken: "server-orchestration-token-at-least-32-characters",
      }),
    ).resolves.toEqual({ repairing: true });

    const document = await t.run((ctx) => ctx.db.get(documentId));
    expect(document).toMatchObject({
      status: "indexing",
      contentHash,
      sourceRevision: `sha256:${contentHash}`,
    });
    expect(document?.indexJobId).toBeUndefined();
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduled.some(
        (job) =>
          job.name.replace(".", ":") ===
          "documentActions:updateDocumentAiSearchMetadata",
      ),
    ).toBe(true);
  });

  it("[P0] rejects cross-user and stale-object repair attempts", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const asOther = t.withIdentity(OTHER_IDENTITY);
    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Owned sources",
    });
    const documentId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        userId: TEST_IDENTITY.tokenIdentifier,
        folderId,
        filename: "legacy.pdf",
        status: "success",
        fileSize: 2048,
        r2Key: "owner/folder/legacy.pdf",
      }),
    );
    const args = {
      documentId,
      expectedR2Key: "owner/folder/legacy.pdf",
      contentHash: "b".repeat(64),
      sourceRevision: `sha256:${"b".repeat(64)}`,
      orchestrationToken: "server-orchestration-token-at-least-32-characters",
    };

    await expect(
      asOther.mutation(api.documents.prepareAudioOverviewSourceRepair, args),
    ).rejects.toThrow(/document not found/i);
    await expect(
      asUser.mutation(api.documents.prepareAudioOverviewSourceRepair, {
        ...args,
        expectedR2Key: "owner/folder/replaced.pdf",
      }),
    ).rejects.toThrow(/source changed/i);
  });
});

describe("documents.listDocumentsByFolder", () => {
  it("[P0] should return documents for a given folder", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "My Folder",
    });
    const storageId1 = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf 1"], { type: "application/pdf" }),
      );
    });
    const storageId2 = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf 2"], { type: "application/pdf" }),
      );
    });

    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "file1.pdf",
      fileId: storageId1,
      fileSize: 1024,
    });
    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "file2.pdf",
      fileId: storageId2,
      fileSize: 2048,
    });

    const docs = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId,
    });
    expect(docs).toHaveLength(2);
    expect(docs.map((d: any) => d.filename)).toContain("file1.pdf");
    expect(docs.map((d: any) => d.filename)).toContain("file2.pdf");
  });

  it("[P0] should return empty array for folder with no documents", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Empty Folder",
    });

    const docs = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId,
    });
    expect(docs).toEqual([]);
  });

  it("[P0] should respect user isolation", async () => {
    const t = convexTest(schema, modules);
    const asUser1 = t.withIdentity(TEST_IDENTITY);
    const asUser2 = t.withIdentity(OTHER_IDENTITY);

    const folder1 = await asUser1.mutation(api.folders.createFolder, {
      name: "User1 Folder",
    });
    await asUser2.mutation(api.folders.createFolder, {
      name: "User2 Folder",
    });

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf"], { type: "application/pdf" }),
      );
    });

    await asUser1.mutation(api.documents.createDocument, {
      folderId: folder1,
      filename: "user1-doc.pdf",
      fileId: storageId,
      fileSize: 1024,
    });

    const user2Docs = await asUser2.query(api.documents.listDocumentsByFolder, {
      folderId: folder1,
    });
    expect(user2Docs).toEqual([]);
  });

  it("[P0] should return no documents to an unauthenticated reader", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Folder",
    });

    await expect(
      t.query(api.documents.listDocumentsByFolder, { folderId }),
    ).resolves.toEqual([]);
  });

  it("[P1] should order documents by _creationTime desc", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Folder",
    });

    const storageId1 = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf 1"], { type: "application/pdf" }),
      );
    });
    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "first.pdf",
      fileId: storageId1,
      fileSize: 1024,
    });

    const storageId2 = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf 2"], { type: "application/pdf" }),
      );
    });
    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "second.pdf",
      fileId: storageId2,
      fileSize: 2048,
    });

    const docs = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId,
    });
    expect(docs[0].filename).toBe("second.pdf");
    expect(docs[1].filename).toBe("first.pdf");
  });
});

describe("documents.updateDocumentStatus (internal)", () => {
  it("[P0] should update status to success", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Folder",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf"], { type: "application/pdf" }),
      );
    });

    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "test.pdf",
      fileId: storageId,
      fileSize: 1024,
    });

    await t.mutation(internal.documents.updateDocumentStatus, {
      id: docId,
      status: "success",
    });

    const docs = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId,
    });
    expect(docs[0].status).toBe("success");
  });

  it("[P0] persists the immutable source fingerprint used by Audio Overview manifests", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Folder",
    });
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["grounded source"])),
    );
    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "source.txt",
      fileId: storageId,
      fileSize: 15,
    });
    const contentHash = "a".repeat(64);

    await t.mutation(internal.documents.updateDocumentStatus, {
      id: docId,
      status: "indexing",
      r2Key: "owner/folder/source.txt",
      contentHash,
      sourceRevision: `sha256:${contentHash}`,
    });

    const [document] = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId,
    });
    expect(document).toMatchObject({
      contentHash,
      sourceRevision: `sha256:${contentHash}`,
    });
  });

  it("[P0] should update status to failed with reason", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Folder",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf"], { type: "application/pdf" }),
      );
    });

    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "corrupt.pdf",
      fileId: storageId,
      fileSize: 1024,
    });

    await t.mutation(internal.documents.updateDocumentStatus, {
      id: docId,
      status: "failed",
      failureReason: "PDF parsing failed: invalid header",
    });

    const docs = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId,
    });
    expect(docs[0].status).toBe("failed");
    expect(docs[0].failureReason).toBe("PDF parsing failed: invalid header");
  });
});

describe("documents.deleteDocument — AC #1, #3", () => {
  async function createDocInFolder(
    t: ReturnType<typeof convexTest>,
    asUser: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  ) {
    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Folder",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf"], { type: "application/pdf" }),
      );
    });
    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "test.pdf",
      fileId: storageId,
      fileSize: 1024,
    });
    return { folderId, storageId, docId };
  }

  it("[P0] should decrement folder documentCount", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { folderId, docId } = await createDocInFolder(t, asUser);

    const folderBefore = await asUser.query(api.folders.getFolder, {
      id: folderId,
    });
    expect(folderBefore!.documentCount).toBe(1);

    await asUser.mutation(api.documents.deleteDocument, { id: docId });

    const folderAfter = await asUser.query(api.folders.getFolder, {
      id: folderId,
    });
    expect(folderAfter!.documentCount).toBe(0);
  });

  it("[P0] should delete the document record from the database", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { folderId, docId } = await createDocInFolder(t, asUser);

    await asUser.mutation(api.documents.deleteDocument, { id: docId });

    const docs = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId,
    });
    expect(docs).toHaveLength(0);
  });

  it("[P0] should delete the file from storage", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { storageId, docId } = await createDocInFolder(t, asUser);

    await asUser.mutation(api.documents.deleteDocument, { id: docId });

    const fileUrl = await t.run(async (ctx) => {
      return await ctx.storage.getUrl(storageId);
    });
    expect(fileUrl).toBeNull();
  });

  it("[P0] should schedule drainPendingCleanup when doc status is success (story 5.2)", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { docId } = await createDocInFolder(t, asUser);

    await t.mutation(internal.documents.updateDocumentStatus, {
      id: docId,
      status: "success",
    });

    await asUser.mutation(api.documents.deleteDocument, { id: docId });

    const scheduledFunctions = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      return jobs.filter(
        (j: any) =>
          j.name === "accountDeletion:drainPendingCleanup" ||
          j.name === "accountDeletion.drainPendingCleanup",
      );
    });
    expect(scheduledFunctions.length).toBeGreaterThan(0);
  });

  it("[P0] should NOT schedule any cleanup when doc status is processing (story 5.2)", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { docId } = await createDocInFolder(t, asUser);

    await asUser.mutation(api.documents.deleteDocument, { id: docId });

    const scheduledFunctions = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      return jobs.filter(
        (j: any) =>
          j.name === "accountDeletion:drainPendingCleanup" ||
          j.name === "accountDeletion.drainPendingCleanup",
      );
    });
    expect(scheduledFunctions).toHaveLength(0);
  });

  it("[P1] should NOT schedule any cleanup when doc status is failed (story 5.2)", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { docId } = await createDocInFolder(t, asUser);

    await t.mutation(internal.documents.updateDocumentStatus, {
      id: docId,
      status: "failed",
      failureReason: "Some error",
    });

    await asUser.mutation(api.documents.deleteDocument, { id: docId });

    const scheduledFunctions = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      return jobs.filter(
        (j: any) =>
          j.name === "accountDeletion:drainPendingCleanup" ||
          j.name === "accountDeletion.drainPendingCleanup",
      );
    });
    expect(scheduledFunctions).toHaveLength(0);
  });

  it("[P0] should reject unauthenticated user", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { docId } = await createDocInFolder(t, asUser);

    await expect(
      t.mutation(api.documents.deleteDocument, { id: docId }),
    ).rejects.toThrow();
  });

  it("[P0] should reject deleting another user's document", async () => {
    const t = convexTest(schema, modules);
    const asUser1 = t.withIdentity(TEST_IDENTITY);
    const asUser2 = t.withIdentity(OTHER_IDENTITY);
    const { docId } = await createDocInFolder(t, asUser1);

    await expect(
      asUser2.mutation(api.documents.deleteDocument, { id: docId }),
    ).rejects.toThrow("Document not found");
  });
});

describe("documents.moveDocument — AC #2", () => {
  async function createDocInFolder(
    t: ReturnType<typeof convexTest>,
    asUser: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
    folderName = "Source Folder",
  ) {
    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: folderName,
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf"], { type: "application/pdf" }),
      );
    });
    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "movable.pdf",
      fileId: storageId,
      fileSize: 1024,
    });
    return { folderId, storageId, docId };
  }

  it("[P0] should update document folderId to destination", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { folderId: srcFolder, docId } = await createDocInFolder(
      t,
      asUser,
      "Source",
    );
    const destFolder = await asUser.mutation(api.folders.createFolder, {
      name: "Destination",
    });

    await asUser.mutation(api.documents.moveDocument, {
      id: docId,
      destinationFolderId: destFolder,
    });

    const srcDocs = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId: srcFolder,
    });
    const destDocs = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId: destFolder,
    });

    expect(srcDocs).toHaveLength(0);
    expect(destDocs).toHaveLength(1);
    expect(destDocs[0].folderId).toBe(destFolder);
  });

  it("[P0] marks an indexed document unavailable for search until moved metadata is reindexed", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { docId } = await createDocInFolder(t, asUser, "Source");
    const destFolder = await asUser.mutation(api.folders.createFolder, {
      name: "Destination",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(docId, {
        status: "success",
        r2Key: `tenant/source/${docId}.pdf`,
      });
    });

    await asUser.mutation(api.documents.moveDocument, {
      id: docId,
      destinationFolderId: destFolder,
    });

    const moved = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId: destFolder,
    });
    expect(moved[0]?.status).toBe("indexing");
    const scheduled = await t.run(
      async (ctx) =>
        await ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduled.some((job) =>
        job.name.includes("updateDocumentAiSearchMetadata"),
      ),
    ).toBe(true);
  });

  it("[P0] invalidates an in-flight indexing job when the document moves", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { docId } = await createDocInFolder(t, asUser, "Source");
    const destFolder = await asUser.mutation(api.folders.createFolder, {
      name: "Destination",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(docId, {
        status: "indexing",
        indexJobId: "stale-source-folder-job",
        r2Key: `tenant/source/${docId}.pdf`,
      });
    });

    await asUser.mutation(api.documents.moveDocument, {
      id: docId,
      destinationFolderId: destFolder,
    });

    const moved = await asUser.query(api.documents.listDocumentsByFolder, {
      folderId: destFolder,
    });
    expect(moved[0]?.status).toBe("indexing");
    expect(moved[0]?.indexJobId).toBeUndefined();
    const scheduled = await t.run(
      async (ctx) =>
        await ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduled.some((job) =>
        job.name.includes("updateDocumentAiSearchMetadata"),
      ),
    ).toBe(true);
  });

  it("[P0] should decrement source and increment destination documentCount", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { folderId: srcFolder, docId } = await createDocInFolder(
      t,
      asUser,
      "Source",
    );
    const destFolder = await asUser.mutation(api.folders.createFolder, {
      name: "Destination",
    });

    const srcBefore = await asUser.query(api.folders.getFolder, {
      id: srcFolder,
    });
    const destBefore = await asUser.query(api.folders.getFolder, {
      id: destFolder,
    });
    expect(srcBefore!.documentCount).toBe(1);
    expect(destBefore!.documentCount).toBe(0);

    await asUser.mutation(api.documents.moveDocument, {
      id: docId,
      destinationFolderId: destFolder,
    });

    const srcAfter = await asUser.query(api.folders.getFolder, {
      id: srcFolder,
    });
    const destAfter = await asUser.query(api.folders.getFolder, {
      id: destFolder,
    });
    expect(srcAfter!.documentCount).toBe(0);
    expect(destAfter!.documentCount).toBe(1);
  });

  it("[P1] should update both folders updatedAt timestamps", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { folderId: srcFolder, docId } = await createDocInFolder(
      t,
      asUser,
      "Source",
    );
    const destFolder = await asUser.mutation(api.folders.createFolder, {
      name: "Destination",
    });

    const srcBefore = await asUser.query(api.folders.getFolder, {
      id: srcFolder,
    });
    const destBefore = await asUser.query(api.folders.getFolder, {
      id: destFolder,
    });

    await asUser.mutation(api.documents.moveDocument, {
      id: docId,
      destinationFolderId: destFolder,
    });

    const srcAfter = await asUser.query(api.folders.getFolder, {
      id: srcFolder,
    });
    const destAfter = await asUser.query(api.folders.getFolder, {
      id: destFolder,
    });
    expect(srcAfter!.updatedAt).toBeGreaterThanOrEqual(
      srcBefore!.updatedAt ?? 0,
    );
    expect(destAfter!.updatedAt).toBeGreaterThanOrEqual(
      destBefore!.updatedAt ?? 0,
    );
  });

  it("[P1] should throw error when moving to same folder", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { folderId, docId } = await createDocInFolder(t, asUser);

    await expect(
      asUser.mutation(api.documents.moveDocument, {
        id: docId,
        destinationFolderId: folderId,
      }),
    ).rejects.toThrow();
  });

  it("[P0] should reject moving another user's document", async () => {
    const t = convexTest(schema, modules);
    const asUser1 = t.withIdentity(TEST_IDENTITY);
    const asUser2 = t.withIdentity(OTHER_IDENTITY);
    const { docId } = await createDocInFolder(t, asUser1);
    const otherFolder = await asUser2.mutation(api.folders.createFolder, {
      name: "Other Folder",
    });

    await expect(
      asUser2.mutation(api.documents.moveDocument, {
        id: docId,
        destinationFolderId: otherFolder,
      }),
    ).rejects.toThrow("Document not found");
  });

  it("[P0] should reject moving to another user's folder", async () => {
    const t = convexTest(schema, modules);
    const asUser1 = t.withIdentity(TEST_IDENTITY);
    const asUser2 = t.withIdentity(OTHER_IDENTITY);
    const { docId } = await createDocInFolder(t, asUser1);
    const otherFolder = await asUser2.mutation(api.folders.createFolder, {
      name: "Other Folder",
    });

    await expect(
      asUser1.mutation(api.documents.moveDocument, {
        id: docId,
        destinationFolderId: otherFolder,
      }),
    ).rejects.toThrow("Folder not found");
  });

  it("[P0] should reject unauthenticated user", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);
    const { docId } = await createDocInFolder(t, asUser);
    const destFolder = await asUser.mutation(api.folders.createFolder, {
      name: "Dest",
    });

    await expect(
      t.mutation(api.documents.moveDocument, {
        id: docId,
        destinationFolderId: destFolder,
      }),
    ).rejects.toThrow();
  });
});

describe("documents.deleteDocument", () => {
  it("[P0] should enqueue ai-search + r2 pendingCleanup rows for an indexed document", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Indexed",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf bytes"], { type: "application/pdf" }),
      );
    });
    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "indexed.pdf",
      fileId: storageId,
      fileSize: 1024,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(docId, {
        status: "success",
        r2Key: `${TEST_IDENTITY.tokenIdentifier}/${docId}.txt`,
      });
    });

    await asUser.mutation(api.documents.deleteDocument, { id: docId });

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("pendingCleanup")
        .withIndex("by_userId", (q) =>
          q.eq("userId", TEST_IDENTITY.tokenIdentifier),
        )
        .collect();
    });

    const r2Rows = rows.filter(
      (r) => r.kind === "r2" && r.documentId === String(docId),
    );
    const aiRows = rows.filter(
      (r) => r.kind === "ai-search" && r.documentId === String(docId),
    );
    expect(r2Rows).toHaveLength(1);
    expect(r2Rows[0].r2Key).toBe(
      `${TEST_IDENTITY.tokenIdentifier}/${docId}.txt`,
    );
    expect(aiRows).toHaveLength(1);
    for (const r of rows) expect(r.attempts).toBe(0);

    const stillThere = await t.run(async (ctx) => ctx.db.get(docId));
    expect(stillThere).toBeNull();
  });

  it("[P0] should enqueue no pendingCleanup rows for a processing document", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Processing",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf"], { type: "application/pdf" }),
      );
    });
    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "wip.pdf",
      fileId: storageId,
      fileSize: 512,
    });

    await asUser.mutation(api.documents.deleteDocument, { id: docId });

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("pendingCleanup")
        .withIndex("by_userId", (q) =>
          q.eq("userId", TEST_IDENTITY.tokenIdentifier),
        )
        .collect();
    });
    expect(rows).toHaveLength(0);

    const stillThere = await t.run(async (ctx) => ctx.db.get(docId));
    expect(stillThere).toBeNull();

    const blob = await t.run(async (ctx) => ctx.storage.get(storageId));
    expect(blob).toBeNull();
  });

  it("[P0] should reject unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "F",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf"], { type: "application/pdf" }),
      );
    });
    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "x.pdf",
      fileId: storageId,
      fileSize: 128,
    });

    await expect(
      t.mutation(api.documents.deleteDocument, { id: docId }),
    ).rejects.toThrow();
  });

  it("[P0] should reject cross-user delete", async () => {
    const t = convexTest(schema, modules);
    const asUserA = t.withIdentity(TEST_IDENTITY);
    const asUserB = t.withIdentity(OTHER_IDENTITY);

    const folderId = await asUserA.mutation(api.folders.createFolder, {
      name: "A",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf"], { type: "application/pdf" }),
      );
    });
    const docId = await asUserA.mutation(api.documents.createDocument, {
      folderId,
      filename: "a.pdf",
      fileId: storageId,
      fileSize: 256,
    });

    await expect(
      asUserB.mutation(api.documents.deleteDocument, { id: docId }),
    ).rejects.toThrow();
  });

  it("[P1] should decrement folder documentCount", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "Count",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf"], { type: "application/pdf" }),
      );
    });
    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "c.pdf",
      fileId: storageId,
      fileSize: 100,
    });

    const pre = await asUser.query(api.folders.getFolder, { id: folderId });
    expect(pre!.documentCount).toBe(1);

    await asUser.mutation(api.documents.deleteDocument, { id: docId });

    const post = await asUser.query(api.folders.getFolder, { id: folderId });
    expect(post!.documentCount).toBe(0);
  });

  it("[P1] should write caller userId (not stale value) into the pendingCleanup row", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(TEST_IDENTITY);

    const folderId = await asUser.mutation(api.folders.createFolder, {
      name: "UidCheck",
    });
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["pdf"], { type: "application/pdf" }),
      );
    });
    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: "u.pdf",
      fileId: storageId,
      fileSize: 100,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(docId, {
        status: "success",
        r2Key: `${TEST_IDENTITY.tokenIdentifier}/${docId}.txt`,
      });
    });

    await asUser.mutation(api.documents.deleteDocument, { id: docId });

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("pendingCleanup")
        .withIndex("by_userId", (q) =>
          q.eq("userId", TEST_IDENTITY.tokenIdentifier),
        )
        .collect();
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.userId).toBe(TEST_IDENTITY.tokenIdentifier);
  });
});
