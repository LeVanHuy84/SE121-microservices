export interface TimelineRandom {
  next(): number;
  nextInt(min: number, max: number): number;
  nextFloat(min: number, max: number): number;
}

export interface TimelinePoint {
  targetId: string;
  createdAt: Date;
  random: TimelineRandom;
}

export interface TimelineBuildOptions {
  userId: string;
  startTime: Date;
  endTime: Date;
  eventCount: number;
  random: TimelineRandom;
}

class SeededRandomImpl implements TimelineRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    const lower = Math.ceil(min);
    const upper = Math.floor(max);
    return Math.floor(this.nextFloat(lower, upper + 1));
  }

  nextFloat(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

function hashSeed(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function createSeededRandom(seed: string | number): TimelineRandom {
  const normalized = typeof seed === 'number' ? String(seed) : seed;
  return new SeededRandomImpl(hashSeed(normalized));
}

export class TimelineGenerator {
  buildTimeline(options: TimelineBuildOptions): TimelinePoint[] {
    const { userId, startTime, endTime, eventCount, random } = options;
    const startMs = startTime.getTime();
    const endMs = endTime.getTime();
    const safeCount = Math.max(1, eventCount);
    const spanMs = Math.max(endMs - startMs, safeCount * 60_000);
    const spacingMs = spanMs / (safeCount + 1);

    const points: TimelinePoint[] = [];

    for (let index = 0; index < safeCount; index += 1) {
      const baseOffset = Math.floor((index + 1) * spacingMs);
      const jitterRange = Math.max(1, Math.floor(spacingMs * 0.45));
      const jitter = random.nextInt(0, jitterRange);
      const timestamp = Math.min(endMs - 1000, startMs + baseOffset + jitter);

      points.push({
        targetId: `seed-${userId.slice(-8)}-${index + 1}-${timestamp}`,
        createdAt: new Date(timestamp),
        random: createSeededRandom(`${userId}:${timestamp}:${index}`),
      });
    }

    points.sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1].createdAt.getTime();
      const current = points[index].createdAt.getTime();
      if (current <= previous) {
        points[index].createdAt = new Date(previous + 60_000);
      }
    }

    return points;
  }
}
