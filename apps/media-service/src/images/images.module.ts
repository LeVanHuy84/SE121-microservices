import { Module } from '@nestjs/common';
import { ImagesService } from './images.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ImagesController } from './images.controller';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: "USER_SERVICE",
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('USER_SERVICE_PORT') ?? 4001,
          },
        }),
      },
    ]),
    CloudinaryModule,
  ],
  providers: [ImagesService],
  controllers: [ImagesController],
})
export class ImagesModule {}
