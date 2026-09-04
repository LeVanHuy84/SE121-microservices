import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';

async function run() {
  const client = await MongoClient.connect(MONGODB_URI);
  const adminDb = client.db().admin();
  const dbs = await adminDb.listDatabases();
  console.log('Databases:', dbs.databases);

  for (const dbInfo of dbs.databases) {
    const db = client.db(dbInfo.name);
    const collections = await db.listCollections().toArray();
    console.log(`Database: ${dbInfo.name}, Collections:`, collections.map(c => c.name));
  }

  await client.close();
}

run().catch(console.error);
