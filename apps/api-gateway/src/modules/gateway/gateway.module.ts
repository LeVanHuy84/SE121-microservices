import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { createProxyMiddleware } from 'http-proxy-middleware';

@Module({})
export class GatewayModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
    .apply(
      createProxyMiddleware({
      target: 'http://localhost:4004',
      changeOrigin: true,
      pathRewrite: {'^/webhook/cloudinary': '/webhook/cloudinary'}
      })
    ).forRoutes('/webhook/cloudinary')
  }
}
