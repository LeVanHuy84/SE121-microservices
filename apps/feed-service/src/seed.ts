import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { MongoModule } from './mongo/mongo.module';
import { SeedModule } from './modules/seed/seed.module';
import { SeedService } from './modules/seed/seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
    }),
    MongoModule,
    SeedModule,
  ],
})
class SeedAppModule {}

async function bootstrap() {
  const logger = new Logger('FeedSeed');
  const app = await NestFactory.createApplicationContext(SeedAppModule);

  try {
    await app.get(SeedService).seedDirect();
    logger.log('Direct seeding completed successfully');
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`Seeding failed: ${error.message}`);
    } else {
      logger.error('Seeding failed with unknown error');
    }

    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void bootstrap();
