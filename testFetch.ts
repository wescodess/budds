import { fetchFolderDocs } from './server/utils/r2-folder';

// Stubbing useRuntimeConfig for the test
global.useRuntimeConfig = () => ({
    r2Endpoint: "https://fdd9729454b03f3d452feb302988b9c4.r2.cloudflarestorage.com",
    r2AccessKeyId: "cce64dd2d665f815e5e6f7dd0ba9a7a6",
    r2SecretAccessKey: "ede0979c80ba135a5f303f6f6ea947cdb1c7bb6b4ac29014f61d3d93494af99b",
    r2BucketName: "budds"
});

async function run() {
    const docs = await fetchFolderDocs({
        userId: "trustworthy-mink-186.convex.site|k171v22nazky6tsbsmt8n07n2984thm4",
        folderId: "jn70gea8ympghf9awf6fq267p184xh40"
    });
    console.log("Docs found:", docs.length);
    for (const doc of docs) {
        console.log(doc.key);
    }
}

run().catch(console.error);
