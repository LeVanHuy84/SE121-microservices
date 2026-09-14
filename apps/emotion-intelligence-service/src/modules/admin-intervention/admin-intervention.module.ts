import { Module } from '@nestjs/common';
import { AdminInterventionService } from './admin-intervention.service';
import { AdminInterventionController } from './admin-intervention.controller';

@Module({
  controllers: [AdminInterventionController],
  providers: [AdminInterventionService],
  exports: [AdminInterventionService],
})
export class AdminInterventionModule {}
