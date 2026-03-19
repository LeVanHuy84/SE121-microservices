import { Injectable } from '@nestjs/common';
import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';
import { RecommendationQueryService } from './recommendation/recommendation-query.service';
import { FriendRecommendation } from './repositories/social-graph.repository';

@Injectable()
export class FriendRecommendationService {
  constructor(
    private readonly recommendationQueryService: RecommendationQueryService,
  ) {}

  async recommendFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<FriendRecommendation>> {
    return this.recommendationQueryService.recommendFriends(userId, query);
  }
}
