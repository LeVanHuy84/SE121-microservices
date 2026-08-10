import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { Group } from 'src/entities/group.entity';
import { Repository } from 'typeorm';
import { GroupMemberStatus } from '@repo/dtos';

@Injectable()
export class GroupRecommendationService {
  constructor(
    @InjectRepository(GroupMember)
    private readonly repo: Repository<GroupMember>,
  ) {}

  async getCommonGroupCountsBatch(
    userId: string,
    candidateIds: string[],
  ): Promise<Record<string, number>> {
    const dedupedCandidateIds = [
      ...new Set(
        candidateIds.filter(
          (candidateId) => Boolean(candidateId) && candidateId !== userId,
        ),
      ),
    ];
    if (!userId || dedupedCandidateIds.length === 0) {
      return {};
    }

    const rows = await this.repo
      .createQueryBuilder('candidateMember')
      .select('candidateMember.userId', 'candidateId')
      .addSelect('COUNT(DISTINCT candidateMember.groupId)', 'commonGroupCount')
      .innerJoin(
        GroupMember,
        'viewerMember',
        'viewerMember.groupId = candidateMember.groupId',
      )
      .where('viewerMember.userId = :userId', { userId })
      .andWhere('viewerMember.status = :activeStatus', {
        activeStatus: GroupMemberStatus.ACTIVE,
      })
      .andWhere('candidateMember.userId IN (:...candidateIds)', {
        candidateIds: dedupedCandidateIds,
      })
      .andWhere('candidateMember.status = :activeStatus', {
        activeStatus: GroupMemberStatus.ACTIVE,
      })
      .groupBy('candidateMember.userId')
      .getRawMany<{ candidateId: string; commonGroupCount: string }>();

    const counts = dedupedCandidateIds.reduce<Record<string, number>>(
      (acc, candidateId) => {
        acc[candidateId] = 0;
        return acc;
      },
      {},
    );

    for (const row of rows) {
      counts[row.candidateId] = Number(row.commonGroupCount) || 0;
    }

    return counts;
  }

  async getCommonGroupNamesBatch(
    userId: string,
    candidateIds: string[],
    limitPerCandidate = 3,
  ): Promise<Record<string, string[]>> {
    const dedupedCandidateIds = [
      ...new Set(
        candidateIds.filter(
          (candidateId) => Boolean(candidateId) && candidateId !== userId,
        ),
      ),
    ];
    if (!userId || dedupedCandidateIds.length === 0) {
      return {};
    }

    const rows = await this.repo
      .createQueryBuilder('candidateMember')
      .select('candidateMember.userId', 'candidateId')
      .addSelect('group.name', 'groupName')
      .addSelect('group.members', 'groupMembers')
      .innerJoin(
        GroupMember,
        'viewerMember',
        'viewerMember.groupId = candidateMember.groupId',
      )
      .innerJoin(Group, 'group', 'group.id = candidateMember.groupId')
      .where('viewerMember.userId = :userId', { userId })
      .andWhere('viewerMember.status = :activeStatus', {
        activeStatus: GroupMemberStatus.ACTIVE,
      })
      .andWhere('candidateMember.userId IN (:...candidateIds)', {
        candidateIds: dedupedCandidateIds,
      })
      .andWhere('candidateMember.status = :activeStatus', {
        activeStatus: GroupMemberStatus.ACTIVE,
      })
      .orderBy('candidateMember.userId', 'ASC')
      .addOrderBy('group.members', 'DESC')
      .addOrderBy('group.name', 'ASC')
      .getRawMany<{
        candidateId: string;
        groupName: string;
        groupMembers: string;
      }>();

    const safeLimit = Math.max(1, Math.floor(limitPerCandidate));
    const grouped = dedupedCandidateIds.reduce<Record<string, string[]>>(
      (acc, candidateId) => {
        acc[candidateId] = [];
        return acc;
      },
      {},
    );

    for (const row of rows) {
      const names = grouped[row.candidateId];
      if (!names || names.length >= safeLimit) {
        continue;
      }

      if (row.groupName && !names.includes(row.groupName)) {
        names.push(row.groupName);
      }
    }

    return grouped;
  }

  async getGroupRecommendationCandidates(
    userId: string,
    limit: number,
  ): Promise<Array<{ id: string; commonGroups: number }>> {
    if (!userId || !Number.isFinite(limit) || limit <= 0) {
      return [];
    }

    const rows = await this.repo
      .createQueryBuilder('candidateMember')
      .select('candidateMember.userId', 'id')
      .addSelect('COUNT(DISTINCT candidateMember.groupId)', 'commonGroups')
      .innerJoin(
        GroupMember,
        'viewerMember',
        'viewerMember.groupId = candidateMember.groupId',
      )
      .where('viewerMember.userId = :userId', { userId })
      .andWhere('viewerMember.status = :activeStatus', {
        activeStatus: GroupMemberStatus.ACTIVE,
      })
      .andWhere('candidateMember.userId <> :userId', { userId })
      .andWhere('candidateMember.status = :activeStatus', {
        activeStatus: GroupMemberStatus.ACTIVE,
      })
      .groupBy('candidateMember.userId')
      .orderBy('commonGroups', 'DESC')
      .addOrderBy('candidateMember.userId', 'ASC')
      .limit(Math.max(1, Math.floor(limit)))
      .getRawMany<{ id: string; commonGroups: string }>();

    return rows.map((row) => ({
      id: row.id,
      commonGroups: Number(row.commonGroups) || 0,
    }));
  }
}
