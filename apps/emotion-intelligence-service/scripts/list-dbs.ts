import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb+srv://huyle842005:rELI9KjYeAOjTmWn@cluster0.b0bspno.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

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
