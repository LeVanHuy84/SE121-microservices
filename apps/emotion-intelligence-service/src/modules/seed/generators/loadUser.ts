import * as fs from 'fs/promises';
import { EmotionBehaviorProfile } from './emotion.generator';

export interface SeedUserProfile {
  userId: string;
  behavior: EmotionBehaviorProfile;
}

export async function loadUsersFromJSON(
  filePath: string,
): Promise<SeedUserProfile[]> {
  const data = await fs.readFile(filePath, 'utf-8');
  const users = JSON.parse(data);

  return users.map((u: any) => ({
    userId: u.userId,
    behavior: randomBehavior(),
  }));
}

function randomBehavior(): EmotionBehaviorProfile {
  const rand = Math.random();

  if (rand < 0.85) return 'positive';
  if (rand < 0.95) return 'downward';
  return 'negative';
}
