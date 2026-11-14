/**
 * redis-test.helper.ts
 * Manages test redis states, feed ZSets, session caches and simulates crash/reconnect.
 */

export class RedisTestHelper {
  private inMemoryStore: Map<string, any> = new Map();
  private zsetStore: Map<string, Array<{ value: string; score: number }>> = new Map();
  private isConnected: boolean = true;

  constructor() {}

  /**
   * Simulates a Redis crash/disconnection.
   */
  simulateCrash(): void {
    this.isConnected = false;
  }

  /**
   * Recovers Redis connection.
   */
  recover(): void {
    this.isConnected = true;
  }

  get connected(): boolean {
    return this.isConnected;
  }

  async get<T = any>(key: string): Promise<T | null> {
    if (!this.isConnected) {
      throw new Error('ECONNREFUSED: Redis connection unavailable (simulated crash)');
    }
    return this.inMemoryStore.get(key) ?? null;
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<'OK'> {
    if (!this.isConnected) {
      throw new Error('ECONNREFUSED: Redis connection unavailable (simulated crash)');
    }
    this.inMemoryStore.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    if (!this.isConnected) {
      throw new Error('ECONNREFUSED: Redis connection unavailable (simulated crash)');
    }
    const existed = this.inMemoryStore.delete(key) || this.zsetStore.delete(key);
    return existed ? 1 : 0;
  }

  async zadd(key: string, score: number, value: string): Promise<number> {
    if (!this.isConnected) {
      throw new Error('ECONNREFUSED: Redis connection unavailable (simulated crash)');
    }
    let list = this.zsetStore.get(key) || [];
    list = list.filter((item) => item.value !== value);
    list.push({ value, score });
    list.sort((a, b) => b.score - a.score); // descending by score (timestamp)
    this.zsetStore.set(key, list);
    return 1;
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.isConnected) {
      throw new Error('ECONNREFUSED: Redis connection unavailable (simulated crash)');
    }
    const list = this.zsetStore.get(key) || [];
    const slice = stop === -1 ? list.slice(start) : list.slice(start, stop + 1);
    return slice.map((item) => item.value);
  }

  async clearAll(): Promise<void> {
    this.inMemoryStore.clear();
    this.zsetStore.clear();
  }
}
