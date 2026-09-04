import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';

async function run() {
  console.log('Connecting to MongoDB via MongoClient...');
  const client = await MongoClient.connect(MONGODB_URI);
  console.log('Connected.');

  const db = client.db('emotion_intelligence_service');

  const userIds = [
    'user_3Ex4A6mdFWMyhcCWKJcO5ZhUWOc', // positive
    'user_3EzbnFwHwvTo96rK5hTBKuZKmBd', // downward
    'user_3Ezbxlc42v85243NgBR7UjTC1MV', // negative
  ];

  console.log('\n--- Risk States ---');
  const riskStates = await db.collection('user_risk_states').find({ userId: { $in: userIds } }).toArray();
  console.log(JSON.stringify(riskStates.map(rs => ({
    userId: rs.userId,
    riskLevel: rs.riskLevel,
    riskScore: rs.riskScore,
    previousRiskScore: rs.previousRiskScore,
    stableWindows: rs.stableWindows,
    lastEvaluatedAt: rs.lastEvaluatedAt,
    updatedAt: rs.updatedAt
  })), null, 2));

  console.log('\n--- Profiles ---');
  const profiles = await db.collection('user_emotion_profiles').find({ userId: { $in: userIds } }).toArray();
  console.log(JSON.stringify(profiles.map(p => ({
    userId: p.userId,
    recentNegativityScore: p.recentNegativityScore,
    negativeEventStreak: p.negativeEventStreak,
    emotionMomentum: p.emotionMomentum
  })), null, 2));

  console.log('\n--- Snapshots (1d) ---');
  const snapshots = await db.collection('user_emotion_snapshots').find({ userId: { $in: userIds }, window: '1d' }).sort({ createdAt: -1 }).toArray();
  
  // Get latest 1d snapshot for each user
  const latestSnapshots = userIds.map(uid => snapshots.find(s => s.userId === uid));
  console.log(JSON.stringify(latestSnapshots.map(s => s ? {
    userId: s.userId,
    negativeRatio: s.negativeRatio,
    emotionVolatility: s.emotionVolatility,
    trend: s.trend,
    baselineNegativeRatio: s.baselineNegativeRatio,
    riskScore: s.riskScore,
    createdAt: s.createdAt
  } : null), null, 2));

  await client.close();
}

run().catch(console.error);
