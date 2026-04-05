import { RiskLevel } from '@repo/dtos';

export interface RiskDetectedEvent {
  userId: string;
  riskLevel: RiskLevel;
  riskScore: number;
}

export interface AiContext {
  riskLevel: RiskLevel;
  riskScore: number;
  negativeRatio: number;
  baselineNegativeRatio: number;
  normalizedNegativity: number;
  volatility: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  recentNegativityScore: number;
  negativeEventStreak: number;
  hasRecentActivity: boolean;
  hasRecentStrongNegative: boolean;
}
