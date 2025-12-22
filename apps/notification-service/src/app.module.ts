import { Module } from '@nestjs/common';
import { SharedModule } from './share.module';
@Module({
  imports: [SharedModule],
})
export class AppModule {}
