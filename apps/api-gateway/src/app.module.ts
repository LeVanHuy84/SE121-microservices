import { Module, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./modules/auth/auth.module";
import { ClerkAuthGuard } from "./modules/auth/clerk-auth.guard";
import { PostModule } from "./modules/posts/post.module";
import { UserModule } from "./modules/users/users.module";
import { ClerkClientProvider } from "./providers/clerk-client.provider";
import { SocialModule } from "./modules/social/social.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // để không cần import ở các module khác
    }),

    AuthModule,
    PostModule,
    UserModule,
    SocialModule,
  ],

  providers: [
    ClerkClientProvider,
    {
      provide: APP_GUARD,
      useClass: ClerkAuthGuard,
    },
    {
      provide: "APP_PIPE",
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
