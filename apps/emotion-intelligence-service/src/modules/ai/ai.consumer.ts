import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AiService } from './ai.service';
import type { RiskDetectedEvent } from './ai.types';

@Injectable()
export class AiConsumer {
  private readonly logger = new Logger(AiConsumer.name);

  constructor(private readonly aiService: AiService) {}

  @OnEvent('risk.detected')
  handleRiskDetected(event: RiskDetectedEvent): void {
    void this.aiService.handleRiskEvent(event).catch((error: unknown) => {
      this.logger.error(
        `AI handling failed user=${event.userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }
}
