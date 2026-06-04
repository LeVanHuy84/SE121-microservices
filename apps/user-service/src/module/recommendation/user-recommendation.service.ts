import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle';
import { ProfileRecommendationCandidateDTO } from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { profiles } from 'src/drizzle/schema/profiles.schema';
import { users } from 'src/drizzle/schema/users.schema';
import { and, eq, ne } from 'drizzle-orm';
import { USER_STATUS } from 'src/constants';
import { ProfileHelper } from '../helpers/profile.helper';

@Injectable()
export class UserRecommendationService {
  constructor(@Inject(DRIZZLE) private db: DrizzleDB) {}

  async getProfileRecommendationCandidates(
    userId: string,
    limit = 20,
  ): Promise<ProfileRecommendationCandidateDTO[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
    const viewer = await this.db
      .select({
        id: users.id,
        location: profiles.location,
        jobTitle: profiles.jobTitle,
        company: profiles.company,
        school: profiles.school,
        interests: profiles.interests,
      })
      .from(users)
      .innerJoin(profiles, eq(users.id, profiles.userId))
      .where(and(eq(users.id, userId), eq(users.status, USER_STATUS.ACTIVE)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!viewer) {
      return [];
    }

    const viewerInterests = ProfileHelper.normalizeInterests(viewer.interests ?? []);
    const hasViewerSignals =
      Boolean(viewer.location) ||
      Boolean(viewer.jobTitle) ||
      Boolean(viewer.company) ||
      Boolean(viewer.school) ||
      viewerInterests.length > 0;

    if (!hasViewerSignals) {
      return [];
    }

    const candidates = await this.db
      .select({
        id: users.id,
        location: profiles.location,
        jobTitle: profiles.jobTitle,
        company: profiles.company,
        school: profiles.school,
        interests: profiles.interests,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(profiles, eq(users.id, profiles.userId))
      .where(and(eq(users.status, USER_STATUS.ACTIVE), ne(users.id, userId)));

    const scoredCandidates = candidates
      .map((candidate) =>
        this.buildProfileRecommendationCandidate(viewer, viewerInterests, candidate),
      )
      .filter((candidate): candidate is ProfileRecommendationCandidateDTO =>
        Boolean(candidate),
      )
      .sort((left, right) => {
        if (right.profileMatchScore !== left.profileMatchScore) {
          return right.profileMatchScore - left.profileMatchScore;
        }

        if (right.sharedInterestsCount !== left.sharedInterestsCount) {
          return right.sharedInterestsCount - left.sharedInterestsCount;
        }

        return left.id.localeCompare(right.id);
      })
      .slice(0, safeLimit);

    return plainToInstance(ProfileRecommendationCandidateDTO, scoredCandidates, {
      excludeExtraneousValues: true,
    });
  }

  private buildProfileRecommendationCandidate(
    viewer: {
      id: string;
      location: string | null;
      jobTitle: string | null;
      company: string | null;
      school: string | null;
      interests: string[];
    },
    viewerInterests: string[],
    candidate: {
      id: string;
      location: string | null;
      jobTitle: string | null;
      company: string | null;
      school: string | null;
      interests: string[];
      createdAt: Date;
    },
  ): ProfileRecommendationCandidateDTO | null {
    const matchedSignals: string[] = [];
    let score = 0;

    if (ProfileHelper.matchesNormalizedText(viewer.location, candidate.location)) {
      matchedSignals.push('location');
      score += 0.2;
    }

    if (ProfileHelper.matchesNormalizedText(viewer.school, candidate.school)) {
      matchedSignals.push('school');
      score += 0.2;
    }

    if (ProfileHelper.matchesNormalizedText(viewer.company, candidate.company)) {
      matchedSignals.push('company');
      score += 0.2;
    }

    if (ProfileHelper.matchesNormalizedText(viewer.jobTitle, candidate.jobTitle)) {
      matchedSignals.push('jobTitle');
      score += 0.1;
    }

    const candidateInterests = ProfileHelper.normalizeInterests(candidate.interests ?? []);
    const viewerInterestSet = new Set(
      viewerInterests.map((interest) => ProfileHelper.normalizeComparableText(interest)),
    );
    const sharedInterestsCount = candidateInterests.reduce((count, interest) => {
      const normalized = ProfileHelper.normalizeComparableText(interest);
      return count + (viewerInterestSet.has(normalized) ? 1 : 0);
    }, 0);

    if (sharedInterestsCount > 0) {
      matchedSignals.push(`interests:${sharedInterestsCount}`);
      score += Math.min(sharedInterestsCount, 3) * 0.1;
    }

    const profileMatchScore = Number(Math.min(1, score).toFixed(6));
    if (profileMatchScore <= 0) {
      return null;
    }

    return {
      id: candidate.id,
      profileMatchScore,
      matchedSignals,
      sharedInterestsCount,
    };
  }
}
