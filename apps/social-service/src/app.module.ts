import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FriendshipModule } from './friendship/friendship.module';
import { Neo4jConfig } from './neo4j/neo4j-config.interface';
import { Neo4jModule } from './neo4j/neo4j.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    Neo4jModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Neo4jConfig => ({
        uri: configService.get<string>('NEO4J_URI')!,
        username: configService.get<string>('NEO4J_USERNAME')!,
        password: configService.get<string>('NEO4J_PASSWORD')!,
        database: configService.get<string>('NEO4J_DATABASE'),
      }),
    }),
    FriendshipModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
