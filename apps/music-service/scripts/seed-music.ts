import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

import { MusicFeature } from '../src/entities/music-feature.entity';
import dbConfig from '../src/config/db.config';
import { MediaType } from '@repo/dtos';

import * as dotenv from 'dotenv';
dotenv.config();

const DATA_FILE = path.join(__dirname, 'music-feature.json');

const AppDataSource = new DataSource({
  ...dbConfig(),
  entities: [MusicFeature],
});

async function seed() {
  await AppDataSource.initialize();
  console.log('DB connected');

  const repo = AppDataSource.getRepository(MusicFeature);

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

  const batchSize = 50; // insert theo batch cho đỡ lag

  for (let i = 0; i < data.length; i += batchSize) {
    const chunk = data.slice(i, i + batchSize);

    const entities = chunk.map((item: any) => {
      return repo.create({
        audio: {
          url: item.url,
          publicId: 'music-features/000000000' + i,
        },
        coverImage: {
          type: MediaType.IMAGE,
          url: item.coverUrl,
          publicId: 'music-features/000000000' + i,
        },
        title: item.title,
        artist: item.artist,

        valence: item.valence,
        arousal: item.arousal,

        tempo: item.tempo,
        rms: item.rms,
        spectralCentroid: item.spectral_centroid,
        zcr: item.zcr,
      });
    });

    await repo.save(entities);

    console.log(` [SUCCESS] Inserted ${i + chunk.length}/${data.length}`);
  }

  console.log('Seeding done!');
  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('[ERROR] Seed error:', err);
});
