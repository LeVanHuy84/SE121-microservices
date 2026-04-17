import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import dbConfig from './config/db.config';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      load: [dbConfig],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: dbConfig,
    }),
    CatalogModule,
    DiscoveryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
