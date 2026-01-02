import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config'; // Import ConfigModule and ConfigService
import { SnapshotRepository } from './repository/snapshot.repository';
import {
  PostSnapshot,
  PostSnapshotSchema,
} from './schema/post-snapshot.schema';
import {
  ShareSnapshot,
  ShareSnapshotSchema,
} from './schema/share-snapshot.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        dbName: 'feed_service',
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
      { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
    ]),
  ],
  providers: [SnapshotRepository],
  exports: [MongooseModule, SnapshotRepository],
})
export class MongoModule {}
