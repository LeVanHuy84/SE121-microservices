import { Injectable } from '@nestjs/common';
import { UserService } from '../../../../modules/user/user.service';
import type { FriendRecommendation } from '../repositories/social-graph.repository';

@Injectable()
export class RecommendationHydrationService {
  constructor(private readonly userService: UserService) {}

  async hydrateRecommendationUsers<T extends FriendRecommendation>(
    recommendations: T[],
  ): Promise<T[]> {
    if (recommendations.length === 0) {
      return recommendations;
    }

    const userIds = [
      ...new Set(
        recommendations.flatMap((recommendation) => [
          recommendation.id,
          ...recommendation.mutualFriendIds.slice(0, 3),
        ]),
      ),
    ];

    const usersById = await this.userService.getBaseUsersBatch(userIds);

    return recommendations.map((recommendation) => ({
      ...recommendation,
      user: usersById[recommendation.id] ?? null,
      mutualFriendPreview: recommendation.mutualFriendIds
        .slice(0, 3)
        .map((mutualFriendId) => usersById[mutualFriendId])
        .filter((user): user is NonNullable<typeof user> => Boolean(user)),
    }));
  }
}
