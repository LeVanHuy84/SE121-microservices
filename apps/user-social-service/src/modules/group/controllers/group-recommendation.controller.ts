import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { GroupRecommendationService } from "../services/group-recommendation.service";

@Controller("recommendation")
export class GroupRecommendationController {
  constructor(
    private readonly groupRecommendationService: GroupRecommendationService,
  ) {}

  @MessagePattern("get_common_group_counts_batch")
  async getCommonGroupCountsBatch(
    @Payload() payload: { userId: string; candidateIds: string[] },
  ): Promise<Record<string, number>> {
    return this.groupRecommendationService.getCommonGroupCountsBatch(
      payload.userId,
      payload.candidateIds,
    );
  }

  @MessagePattern("get_common_group_names_batch")
  async getCommonGroupNamesBatch(
    @Payload()
    payload: {
      userId: string;
      candidateIds: string[];
      limitPerCandidate?: number;
    },
  ): Promise<Record<string, string[]>> {
    return this.groupRecommendationService.getCommonGroupNamesBatch(
      payload.userId,
      payload.candidateIds,
      payload.limitPerCandidate,
    );
  }

  @MessagePattern("get_group_recommendation_candidates")
  async getGroupRecommendationCandidates(
    @Payload() payload: { userId: string; limit: number },
  ): Promise<Array<{ id: string; commonGroups: number }>> {
    return this.groupRecommendationService.getGroupRecommendationCandidates(
      payload.userId,
      payload.limit,
    );
  }
}
