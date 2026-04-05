import { Injectable } from '@nestjs/common';
import { InsightEngine } from './insight.engine';
import { Insight, InsightContext } from './insight.types';

@Injectable()
export class InsightFacade {
  constructor(private readonly insightEngine: InsightEngine) {}

  generate(context: InsightContext): Insight[] {
    return this.insightEngine.generate(context);
  }
}
