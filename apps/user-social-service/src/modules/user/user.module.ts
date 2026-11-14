import { Module } from "@nestjs/common";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";
import { UserEventController } from "./user-event.controller";
import { DrizzleModule } from "src/drizzle/drizzle.module";
import { ClientsModule, Transport } from "@nestjs/microservices";
import {
  IdempotencyService,
  KafkaConsumerHelper,
  KafkaDLQService,
  KafkaProducerModule,
} from "@repo/common";
import { DrizzleIdempotencyRepository } from "../group/services/drizzle-idempotency.repository";

@Module({
  controllers: [UserController, UserEventController],
  providers: [
    UserService,
    DrizzleIdempotencyRepository,
    KafkaConsumerHelper,
    KafkaDLQService,
  ],
  exports: [UserService],
  imports: [
    DrizzleModule,
    {
      module: class CustomUserIdempotencyModule {},
      imports: [DrizzleModule],
      providers: [
        DrizzleIdempotencyRepository,
        {
          provide: "IdempotencyRepository",
          useExisting: DrizzleIdempotencyRepository,
        },
        IdempotencyService,
      ],
      exports: [IdempotencyService],
    },
    KafkaProducerModule.registerAsync(),
    ClientsModule.register([
      {
        name: "SOCIAL_SERVICE",
        transport: Transport.REDIS,
        options: {
          host: "localhost",
          port: 6379,
        },
      },
    ]),
  ],
})
export class UserModule {}
