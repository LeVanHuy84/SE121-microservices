import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SeedService } from '../src/modules/seed/seed.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const seedService = app.get(SeedService);

  console.log('🌱 Seeding emotion data...');

  await seedService.seedAll({
    days: 3,
  });

  console.log('✅ Seed completed');

  await app.close();
}

bootstrap();
