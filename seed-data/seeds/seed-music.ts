import 'reflect-metadata';

import * as dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { MediaType, MusicGenre } from '@repo/dtos';

import { MusicFeature } from '../../apps/music-service/src/entities/music-feature.entity';
import dbConfig from '../../apps/music-service/src/config/db.config';

type RawMusicFeature = {
  url: string;
  coverUrl: string;
  title: string;
  artist: string;
  genre: string;
  valence: number;
  arousal: number;
};

type MusicFeatureSeedRow = {
  audio: {
    url: string;
    publicId: string;
  };
  coverImage: {
    type: MediaType;
    url: string;
    publicId: string;
  };
  title: string;
  artist: string;
  genre: MusicGenre;
  valence: number;
  arousal: number;
};

const ROOT_DIR = resolve(__dirname, '../..');
const DATA_FILE = resolve(__dirname, '../data/music-feature.json');
const ENV_CANDIDATES = [
  resolve(ROOT_DIR, 'apps/music-service/.env'),
  resolve(ROOT_DIR, 'apps/music-service/.env.local'),
];

function loadMusicServiceEnv(): string {
  for (const envFile of ENV_CANDIDATES) {
    if (!existsSync(envFile)) {
      continue;
    }

    dotenv.config({ path: envFile });

    if (process.env.MUSIC_DATABASE_URL) {
      return envFile;
    }
  }

  throw new Error(
    'Unable to find MUSIC_DATABASE_URL. Expected apps/music-service/.env or .env.local',
  );
}

function loadRawMusicFeatures(): RawMusicFeature[] {
  const content = readFileSync(DATA_FILE, 'utf-8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(
      'music-feature.json must contain an array of music features',
    );
  }

  return parsed as RawMusicFeature[];
}

function normalizeGenre(value: string): MusicGenre {
  if (!Object.values(MusicGenre).includes(value as MusicGenre)) {
    throw new Error(`Unsupported music genre: ${value}`);
  }

  return value as MusicGenre;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be greater than 0');
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildSeedRows(rawFeatures: RawMusicFeature[]): MusicFeatureSeedRow[] {
  return rawFeatures.map((item, index) => {
    const uniqueId = `${index + 1}`.padStart(6, '0');

    return {
      audio: {
        url: item.url,
        publicId: `music-features/audio-${uniqueId}`,
      },
      coverImage: {
        type: MediaType.IMAGE,
        url: item.coverUrl,
        publicId: `music-features/cover-${uniqueId}`,
      },
      title: item.title,
      artist: item.artist,
      genre: normalizeGenre(item.genre),
      valence: item.valence,
      arousal: item.arousal,
    };
  });
}

async function main(): Promise<void> {
  const envFile = loadMusicServiceEnv();
  const mongoUri = process.env.MUSIC_DATABASE_URL;

  if (!mongoUri) {
    throw new Error(`MUSIC_DATABASE_URL is missing after loading ${envFile}`);
  }

  const rawMusicFeatures = loadRawMusicFeatures();
  const seedRows = buildSeedRows(rawMusicFeatures);
  const dataSource = new DataSource({
    ...dbConfig(),
    entities: [MusicFeature],
  });

  await dataSource.initialize();

  try {
    const repo = dataSource.getRepository(MusicFeature);

    await repo.clear();

    for (const chunk of chunkArray(seedRows, 50)) {
      const entities = chunk.map((item) => repo.create(item));

      await repo.save(entities);
      console.log(`[SUCCESS] Inserted ${entities.length} music features`);
    }

    console.log('Seeding done!');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('[ERROR] Seed error:', error);
  process.exitCode = 1;
});
