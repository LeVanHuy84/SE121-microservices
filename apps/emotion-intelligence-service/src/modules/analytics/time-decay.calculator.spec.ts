import { TimeDecayCalculator } from './time-decay.calculator';

describe('TimeDecayCalculator', () => {
  let calculator: TimeDecayCalculator;

  beforeEach(() => {
    calculator = new TimeDecayCalculator();
  });

  describe('calculateDecayedScore', () => {
    it('should decay score exponentially over time', () => {
      const initialScore = 0.8;
      const decayed24h = calculator.calculateDecayedScore(initialScore, 24);
      const decayed48h = calculator.calculateDecayedScore(initialScore, 48);

      expect(decayed24h).toBeLessThan(initialScore);
      expect(decayed48h).toBeLessThan(decayed24h);
    });

    it('should return previous score if deltaHours <= 0', () => {
      expect(calculator.calculateDecayedScore(0.5, 0)).toBe(0.5);
      expect(calculator.calculateDecayedScore(0.5, -5)).toBe(0.5);
    });
  });

  describe('updateEMA', () => {
    it('should correctly calculate EMA vector with higher alpha for DIARY', () => {
      const prevEMA = { joy: 0.2, sadness: 0.8 };
      const currScores = { joy: 0.9, sadness: 0.1 };

      const diaryResult = calculator.updateEMA(prevEMA, currScores, 'DIARY');
      const postResult = calculator.updateEMA(prevEMA, currScores, 'POST');

      // DIARY (alpha = 0.6) should adapt faster to current scores than POST (alpha = 0.3)
      expect(diaryResult.joy).toBeGreaterThan(postResult.joy);
      expect(diaryResult.sadness).toBeLessThan(postResult.sadness);
    });
  });
});
