import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ProactiveInterventionService } from './proactive-intervention.service';
import { RiskLevel } from '@repo/dtos';

@Controller()
export class ProactiveInterventionController {
  constructor(
    private readonly proactiveInterventionService: ProactiveInterventionService,
  ) {}

  @MessagePattern('emotion.intervention.history')
  async getUserInterventionHistory(
    @Payload() payload: { userId: string; limit?: number },
  ) {
    return this.proactiveInterventionService.getUserInterventionHistory(
      payload.userId,
      payload.limit,
    );
  }

  @MessagePattern('emotion.intervention.get_by_id')
  async getUserInterventionById(
    @Payload() payload: { userId: string; id: string },
  ) {
    return this.proactiveInterventionService.getUserInterventionById(
      payload.userId,
      payload.id,
    );
  }
}
