import { Injectable } from '@nestjs/common';
import {
  InternalMusicQueryDto,
  MusicFeatureResponse,
  PaginationDTO,
  RiskLevel,
} from '@repo/dtos';
import { CatalogService } from '../../catalog/catalog.service';
import { EmotionSignalService } from '../../discovery/emotion-signal.service';
import { EmotionMappingService } from './emotion-mapping.service';
import { EmotionState, EmotionStateService } from './emotion-state.service';

export interface TargetEmotion {
  valence: number;
  arousal: number;
}

export interface RecommendationResult {
  state: EmotionState;
  valence: number;
  arousal: number;
  target: TargetEmotion;
  songs: MusicFeatureResponse[];
}

const TARGET_BY_STATE: Record<EmotionState, TargetEmotion> = {
  [EmotionState.STRESS]: { valence: 0.6, arousal: 0.3 },
  [EmotionState.SAD]: { valence: 0.7, arousal: 0.4 },
  [EmotionState.ANGRY]: { valence: 0.5, arousal: 0.4 },
  [EmotionState.CALM]: { valence: 0.6, arousal: 0.5 },
  [EmotionState.NEUTRAL]: { valence: 0.55, arousal: 0.5 },
};

@Injectable()
export class RecommendationService {
  constructor(
    private readonly emotionSignalService: EmotionSignalService,
    private readonly catalogService: CatalogService,
    private readonly emotionMappingService: EmotionMappingService,
    private readonly emotionStateService: EmotionStateService,
  ) {}

  async getRecommendations(
    userId: string,
    pagination: PaginationDTO,
  ): Promise<RecommendationResult> {
    const offset = (pagination.page - 1) * pagination.limit;

    const analysis = await this.getEmotionAnalysis(userId);

    const target = this.computeTarget(analysis);

    const RANGE = 0.15; // bounding box

    const query: InternalMusicQueryDto = {
      valenceMin: Math.max(0, target.valence - RANGE),
      valenceMax: Math.min(1, target.valence + RANGE),
      arousalMin: Math.max(0, target.arousal - RANGE),
      arousalMax: Math.min(1, target.arousal + RANGE),

      limit: pagination.limit,
      offset,

      sortByDistanceTo: {
        valence: target.valence,
        arousal: target.arousal,
        weightValence: this.getValenceWeight(analysis.state),
        weightArousal: this.getArousalWeight(analysis.state),
      },
    };

    const songs = await this.catalogService.queryForRecommendation(query);

    return {
      state: analysis.state,
      valence: analysis.valence,
      arousal: analysis.arousal,
      target,
      songs,
    };
  }

  // =========================
  // EMOTION
  // =========================

  private async getEmotionAnalysis(userId: string): Promise<{
    state: EmotionState;
    valence: number;
    arousal: number;
    emotionVector: Record<string, number>;
    riskLevel: RiskLevel;
  }> {
    const signal = await this.emotionSignalService.getUserEmotionSignal(userId);

    const emotionVector = signal?.emotionVector ?? { neutral: 1 };

    const { valence, arousal } =
      this.emotionMappingService.toValenceArousal(emotionVector);

    const state = this.emotionStateService.classify(
      valence,
      arousal,
      signal?.riskLevel ?? RiskLevel.NORMAL,
    );

    return {
      state,
      valence,
      arousal,
      emotionVector,
      riskLevel: signal?.riskLevel ?? RiskLevel.NORMAL,
    };
  }

  private computeTarget(analysis: {
    valence: number;
    arousal: number;
    state: EmotionState;
  }): TargetEmotion {
    const baseTarget =
      TARGET_BY_STATE[analysis.state] ?? TARGET_BY_STATE[EmotionState.NEUTRAL];

    const alpha = 0.4; // độ "dịch chuyển cảm xúc"

    return {
      valence:
        analysis.valence + alpha * (baseTarget.valence - analysis.valence),
      arousal:
        analysis.arousal + alpha * (baseTarget.arousal - analysis.arousal),
    };
  }

  private getValenceWeight(state: EmotionState): number {
    switch (state) {
      case EmotionState.SAD:
      case EmotionState.STRESS:
        return 0.7;

      case EmotionState.ANGRY:
        return 0.5;

      default:
        return 0.6;
    }
  }

  private getArousalWeight(state: EmotionState): number {
    switch (state) {
      case EmotionState.STRESS:
        return 0.8;

      case EmotionState.ANGRY:
        return 0.7;

      default:
        return 0.4;
    }
  }
}
