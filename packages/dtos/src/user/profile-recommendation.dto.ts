import { Expose } from 'class-transformer';

export class ProfileRecommendationCandidateDTO {
  @Expose()
  id: string;

  @Expose()
  profileMatchScore: number;

  @Expose()
  matchedSignals: string[];

  @Expose()
  sharedInterestsCount: number;
}

export class SemanticRecommendationCandidateDTO {
  @Expose()
  id: string;

  @Expose()
  semanticMatchScore: number;
}
