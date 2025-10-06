import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Share } from 'src/entities/share.entity';
import { ShareStat } from 'src/entities/share-stat.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Share, ShareStat])],
  controllers: [ShareController],
  providers: [ShareService],
})
export class ShareModule {}
