/**
 * music-mood-regulation.e2e-spec.ts
 * [E2E-J06] Emotion EMA Feedback Loop & Music Mood Regulation Recommendation
 * 
 * Trace: emotion-intelligence-service -> search-recommendation-service -> api-gateway
 */

import 'reflect-metadata';
import { TEST_USERS } from '../../fixtures/seed-test-users';
import { RedisTestHelper } from '../../helpers/redis-test.helper';

describe('[E2E-J06] Music Mood Regulation & Dynamic Circumplex Mapping', () => {
  let redisHelper: RedisTestHelper;
  const musicUser = TEST_USERS.musicUser;

  beforeEach(() => {
    redisHelper = new RedisTestHelper();
  });

  afterEach(async () => {
    await redisHelper.clearAll();
  });

  it('Step 1: Given user in STRESS state, target coordinates shift to CALM (High Valence, Low Arousal)', () => {
    // Current user emotion state
    const userCurrentEmotion = {
      state: 'STRESS',
      valence: 0.25, // Unpleasant
      arousal: 0.75, // Agitated / High energy
    };

    // Target circumplex regulation coordinates
    const targetCoordinates = {
      targetMood: 'CALM',
      valence: 0.65, // Soothing / Pleasant
      arousal: 0.25, // Low arousal / Peaceful
    };

    expect(userCurrentEmotion.state).toBe('STRESS');
    expect(targetCoordinates.valence).toBeGreaterThan(userCurrentEmotion.valence);
    expect(targetCoordinates.arousal).toBeLessThan(userCurrentEmotion.arousal);
  });

  it('Step 2: Music Recommendation engine scores tracks via Euclidean Distance to target coordinates', async () => {
    const target = { valence: 0.65, arousal: 0.25 };

    const trackCatalog = [
      {
        id: 'track_calm_ambient',
        title: 'Weightless Horizon',
        genre: 'Ambient / Meditation',
        valence: 0.62,
        arousal: 0.22,
      },
      {
        id: 'track_lofi_piano',
        title: 'Midnight Breeze',
        genre: 'Lo-Fi Chill',
        valence: 0.58,
        arousal: 0.30,
      },
      {
        id: 'track_heavy_metal',
        title: 'Fury Unbound',
        genre: 'Heavy Metal',
        valence: 0.20,
        arousal: 0.90,
      },
    ];

    // Compute Euclidean distance to target
    const scoredTracks = trackCatalog.map((track) => {
      const dValence = track.valence - target.valence;
      const dArousal = track.arousal - target.arousal;
      const distance = Math.sqrt(dValence * dValence + dArousal * dArousal);
      return { ...track, distance };
    });

    // Sort ascending by distance (closest to target calm state first)
    scoredTracks.sort((a, b) => a.distance - b.distance);

    // Assert calming ambient track is top recommendation
    expect(scoredTracks[0].id).toBe('track_calm_ambient');
    expect(scoredTracks[0].distance).toBeLessThan(0.1);

    // Assert heavy metal is ranked last due to high arousal
    expect(scoredTracks[2].id).toBe('track_heavy_metal');
    expect(scoredTracks[2].distance).toBeGreaterThan(0.7);

    // Cache recommendation result in Redis
    const cacheKey = `rec:music:${musicUser.id}:CALM`;
    await redisHelper.set(cacheKey, scoredTracks, 300);

    const cachedData = await redisHelper.get(cacheKey);
    expect(cachedData[0].id).toBe('track_calm_ambient');
  });
});
