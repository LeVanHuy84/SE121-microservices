import { Global, Module } from '@nestjs/common';
import { CacheLayerService } from './cache-layer.service';

@Global()
@Module({
  providers: [CacheLayerService],
  exports: [CacheLayerService],
})
export class CacheLayerModule {}
