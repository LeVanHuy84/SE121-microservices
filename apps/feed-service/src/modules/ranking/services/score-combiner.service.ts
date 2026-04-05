import { Injectable } from '@nestjs/common';

@Injectable()
export class ScoreCombinerService {
  combine(input: { base: number; emotion: number; affinity: number }): number {
    return 0.5 * input.base + 0.3 * input.emotion + 0.2 * input.affinity;
  }
}
