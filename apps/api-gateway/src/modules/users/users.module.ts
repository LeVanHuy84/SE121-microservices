import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersController } from './users.controller';

@Module({
    imports: [
        ClientsModule.registerAsync([
            {
                name: MICROSERVICES_CLIENTS.USER_SERVICE,
                imports: [ConfigModule],
                inject: [ConfigService],
                useFactory: (config: ConfigService) => ({
                    transport: Transport.TCP,
                    options: {
                        port: config.get<number>('USER_SERVICE_PORT'),
                    },
                }),
            },
        ]),
    ],
    controllers: [UsersController]
})
export class PostsModule { }
