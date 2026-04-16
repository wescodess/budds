import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const client = new S3Client({
    region: 'auto',
    endpoint: "https://fdd9729454b03f3d452feb302988b9c4.r2.cloudflarestorage.com",
    credentials: {
        accessKeyId: "cce64dd2d665f815e5e6f7dd0ba9a7a6",
        secretAccessKey: "ede0979c80ba135a5f303f6f6ea947cdb1c7bb6b4ac29014f61d3d93494af99b",
    },
});

async function run() {
    const list = await client.send(new ListObjectsV2Command({
        Bucket: "budds",
        MaxKeys: 100,
    }));
    const keys = list.Contents?.map(o => o.Key) || [];
    console.log(keys);
}

run().catch(console.error);
