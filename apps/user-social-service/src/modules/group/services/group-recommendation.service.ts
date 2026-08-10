import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import { groupMembers, groups } from 'src/drizzle/schema/schema';
import { GroupMemberStatus } from '@repo/dtos';

@Injectable()
export class GroupRecommendationService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async getCommonGroupCountsBatch(
    userId: string,
    candidateIds: string[],
  ): Promise<Record<string, number>> {
    const dedupedCandidateIds = [
      ...new Set(
        candidateIds.filter((id) => Boolean(id) && id !== userId),
      ),
    ];
    if (!userId || dedupedCandidateIds.length === 0) return {};

    // candidate members inner join viewer members on groupId
    const rows = await this.db.execute<{
      candidateId: string;
      commonGroupCount: string;
    }>(sql`
      SELECT
        cm."user_id" AS "candidateId",
        COUNT(DISTINCT cm."group_id") AS "commonGroupCount"
      FROM ${groupMembers} cm
      INNER JOIN ${groupMembers} vm
        ON vm."group_id" = cm."group_id"
      WHERE vm."user_id" = ${userId}
        AND vm."status" = ${GroupMemberStatus.ACTIVE}
        AND cm."user_id" IN (${sql.join(dedupedCandidateIds.map((id) => sql`${id}`), sql`, `)})
        AND cm."status" = ${GroupMemberStatus.ACTIVE}
      GROUP BY cm."user_id"
    `);

    const counts = dedupedCandidateIds.reduce<Record<string, number>>(
      (acc, id) => { acc[id] = 0; return acc; },
      {},
    );
    for (const row of rows.rows) {
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
        candidateIds.filter((id) => Boolean(id) && id !== userId),
      ),
    ];
    if (!userId || dedupedCandidateIds.length === 0) return {};

    const rows = await this.db.execute<{
      candidateId: string;
      groupName: string;
      groupMembers: string;
    }>(sql`
      SELECT
        cm."user_id" AS "candidateId",
        g."name" AS "groupName",
        g."members" AS "groupMembers"
      FROM ${groupMembers} cm
      INNER JOIN ${groupMembers} vm
        ON vm."group_id" = cm."group_id"
      INNER JOIN ${groups} g ON g."id" = cm."group_id"
      WHERE vm."user_id" = ${userId}
        AND vm."status" = ${GroupMemberStatus.ACTIVE}
        AND cm."user_id" IN (${sql.join(dedupedCandidateIds.map((id) => sql`${id}`), sql`, `)})
        AND cm."status" = ${GroupMemberStatus.ACTIVE}
      ORDER BY cm."user_id" ASC, g."members" DESC, g."name" ASC
    `);

    const safeLimit = Math.max(1, Math.floor(limitPerCandidate));
    const grouped = dedupedCandidateIds.reduce<Record<string, string[]>>(
      (acc, id) => { acc[id] = []; return acc; },
      {},
    );

    for (const row of rows.rows) {
      const names = grouped[row.candidateId];
      if (!names || names.length >= safeLimit) continue;
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
    if (!userId || !Number.isFinite(limit) || limit <= 0) return [];

    const rows = await this.db.execute<{ id: string; commonGroups: string }>(sql`
      SELECT
        cm."user_id" AS "id",
        COUNT(DISTINCT cm."group_id") AS "commonGroups"
      FROM ${groupMembers} cm
      INNER JOIN ${groupMembers} vm
        ON vm."group_id" = cm."group_id"
      WHERE vm."user_id" = ${userId}
        AND vm."status" = ${GroupMemberStatus.ACTIVE}
        AND cm."user_id" <> ${userId}
        AND cm."status" = ${GroupMemberStatus.ACTIVE}
      GROUP BY cm."user_id"
      ORDER BY "commonGroups" DESC, cm."user_id" ASC
      LIMIT ${Math.max(1, Math.floor(limit))}
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      commonGroups: Number(row.commonGroups) || 0,
    }));
  }
}
