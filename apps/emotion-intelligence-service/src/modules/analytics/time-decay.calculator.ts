import { Injectable } from '@nestjs/common';

@Injectable()
export class TimeDecayCalculator {
  // Đợi suy giảm: lambda = 0.015 tương đương điểm giảm 50% sau ~46h nếu không có bài mới
  private readonly lambda = 0.015;

  /**
   * Tính toán điểm tiêu cực suy giảm theo khoảng thời gian deltaHours (bằng giờ)
   */
  calculateDecayedScore(previousScore: number, deltaHours: number): number {
    if (deltaHours <= 0 || previousScore <= 0) {
      return Math.max(0, previousScore);
    }
    const decayed = previousScore * Math.exp(-this.lambda * deltaHours);
    return Math.max(0, Number(decayed.toFixed(4)));
  }

  /**
   * Cập nhật vector EMA cảm xúc (7 nhãn)
   * alpha = 0.6 cho DIARY, alpha = 0.3 cho POST/COMMENT
   */
  updateEMA(
    previousEMA: Record<string, number> = {},
    currentScores: Record<string, number> = {},
    targetType: string = 'POST',
  ): Record<string, number> {
    const alpha = targetType === 'DIARY' ? 0.6 : 0.3;
    const emotions = [
      'joy',
      'sadness',
      'anger',
      'fear',
      'disgust',
      'surprise',
      'neutral',
    ];

    const updatedEMA: Record<string, number> = {};

    for (const emo of emotions) {
      const prevVal = previousEMA[emo] || 0.0;
      const currVal = currentScores[emo] || 0.0;
      const newEMA = alpha * currVal + (1 - alpha) * prevVal;
      updatedEMA[emo] = Number(newEMA.toFixed(4));
    }

    return updatedEMA;
  }
}
