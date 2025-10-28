import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { ClerkAuthGuard } from './modules/auth/clerk-auth.guard';
import { MediaModule } from './modules/media/media.module';
import { NotificationModule } from './modules/notification/notification.module';
import { PostModule } from './modules/posts/post.module';
import { SocialModule } from './modules/social/social.module';
import { UserModule } from './modules/users/users.module';
import { ClerkClientProvider } from './providers/clerk-client.provider';
import { RabbitmqModule } from '@repo/common';
import { FeedModule } from './modules/feed/feed.module';
import { GroupModule } from './modules/group/group.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // để không cần import ở các module khác
    }),

    AuthModule,
    PostModule,
    UserModule,
    SocialModule,
    MediaModule,
    FeedModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000,
          limit: 50,
        },
      ],
    }),
    NotificationModule,
    RabbitmqModule.register({
      urls: ['amqp://guest:guest@localhost:5672'], // hoặc 'amqp://rabbitmq:5672' nếu docker
      exchanges: [
        { name: 'notification', type: 'topic' },
        { name: 'broadcast', type: 'fanout' },
      ],
    }),
    GroupModule,
  ],

  providers: [
    ClerkClientProvider,
    {
      provide: APP_GUARD,
      useClass: ClerkAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: 'APP_PIPE',
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    },
  ],

  controllers: [],
})
export class AppModule {}
