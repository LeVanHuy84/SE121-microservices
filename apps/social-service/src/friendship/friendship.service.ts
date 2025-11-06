import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { int, Transaction } from 'neo4j-driver';
import { Neo4jService } from 'src/neo4j/neo4j.service';
import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';

@Injectable()
export class FriendshipService {
  constructor(private readonly neo4j: Neo4jService) {}

  // ----- Get relationship status -----
  async getRelationshipStatus(userId: string, targetId: string) {
    const res = await this.neo4j.read(
      `
      MATCH (u:User {id:$userId}), (t:User {id:$targetId})
      OPTIONAL MATCH (u)-[f:FRIEND_WITH]-(t)
      OPTIONAL MATCH (u)-[b:BLOCKED]->(t)
      OPTIONAL MATCH (u)-[reqOut:REQUESTED]->(t)
      OPTIONAL MATCH (t)-[reqIn:REQUESTED]->(u)
      RETURN 
        count(f) > 0 as isFriend,
        count(b) > 0 as isBlocked,
        count(reqOut) > 0 as hasRequestedOut,
        count(reqIn) > 0 as hasRequestedIn
      `,
      { userId, targetId },
    );

    const r = res.records[0];
    if (r.get('isFriend')) return { status: 'FRIEND' };
    if (r.get('isBlocked')) return { status: 'BLOCKED' };
    if (r.get('hasRequestedOut')) return { status: 'REQUESTED_OUT' };
    if (r.get('hasRequestedIn')) return { status: 'REQUESTED_IN' };
    return { status: 'NONE' };
  }

  // ----- Send friend request -----
  async sendFriendRequest(tx: Transaction, userId: string, targetId: string) {
    const status = await this.getRelationshipStatus(userId, targetId);

    if (status.status === 'FRIEND') {
      throw new BadRequestException('Already friends');
    }
    if (status.status === 'REQUESTED_OUT') {
      throw new BadRequestException('Friend request already sent');
    }
    if (status.status === 'BLOCKED') {
      throw new BadRequestException('Cannot send request to a blocked user');
    }

    await this.neo4j.write(
      `MERGE (u:User {id:$userId}) 
       MERGE (t:User {id:$targetId}) 
       MERGE (u)-[:REQUESTED]->(t)`,
      { userId, targetId },
      tx,
    );

    return { message: 'Friend request sent successfully' };
  }
  async cancelFriendRequest(tx: Transaction, userId: string, targetId: string) {
    const status = await this.getRelationshipStatus(userId, targetId);

    // Chỉ được hủy khi bạn là người gửi lời mời
    if (status.status !== 'REQUESTED_OUT') {
      throw new BadRequestException('No outgoing friend request to cancel');
    }

    await this.neo4j.write(
      `
    MATCH (u:User {id:$userId})-[r:REQUESTED]->(t:User {id:$targetId})
    DELETE r
    `,
      { userId, targetId },
      tx,
    );

    return { message: 'Friend request canceled successfully' };
  }

  // ----- Accept friend request -----
  async acceptFriendRequest(
    tx: Transaction,
    userId: string,
    requesterId: string,
  ) {
    const status = await this.getRelationshipStatus(userId, requesterId);
    if (status.status !== 'REQUESTED_IN') {
      throw new BadRequestException('No pending friend request to accept');
    }

    await this.neo4j.write(
      `MATCH (r:User {id:$requesterId})-[req:REQUESTED]->(u:User {id:$userId})
       DELETE req
       MERGE (u)-[:FRIEND_WITH {since:datetime(), sentimentScore:0}]->(r)
       MERGE (r)-[:FRIEND_WITH {since:datetime(), sentimentScore:0}]->(u)`,
      { userId, requesterId },
      tx,
    );

    return { message: 'Friend request accepted' };
  }
  // ----- Decline friend request -----
  async declineFriendRequest(
    tx: Transaction,
    userId: string,
    requesterId: string,
  ) {
    const status = await this.getRelationshipStatus(userId, requesterId);
    if (status.status !== 'REQUESTED_IN') {
      throw new BadRequestException('No pending friend request to decline');
    }

    await this.neo4j.write(
      `MATCH (requester:User {id:$requesterId})-[req:REQUESTED]->(receiver:User {id:$userId})
       DELETE req`,
      { userId, requesterId },
      tx,
    );

    return { message: 'Friend request declined' };
  }

  // ----- Remove friend -----
  async removeFriend(tx: Transaction, userId: string, friendId: string) {
    const status = await this.getRelationshipStatus(userId, friendId);
    if (status.status !== 'FRIEND') {
      throw new BadRequestException('Not friends');
    }

    await this.neo4j.write(
      `MATCH (u:User {id:$userId})-[f:FRIEND_WITH]-(fr:User {id:$friendId})
       DELETE f`,
      { userId, friendId },
      tx,
    );

    return { message: 'Friend removed successfully' };
  }

  // ----- Block / Unblock -----
  async blockUser(tx: Transaction, userId: string, targetId: string) {
    const status = await this.getRelationshipStatus(userId, targetId);
    if (status.status === 'BLOCKED') {
      throw new BadRequestException('User already blocked');
    }

    await this.neo4j.write(
      `MATCH (a:User {id:$userId}), (b:User {id:$targetId})
       OPTIONAL MATCH (a)-[r:FRIEND_WITH|REQUESTED|FOLLOWS]-(b)
       DELETE r
       MERGE (a)-[:BLOCKED]->(b)`,
      { userId, targetId },
      tx,
    );
  }

  async unblockUser(tx: Transaction, userId: string, targetId: string) {
    const status = await this.getRelationshipStatus(userId, targetId);
    if (status.status !== 'BLOCKED') {
      throw new BadRequestException('User is not blocked');
    }

    await this.neo4j.write(
      `MATCH (a:User {id:$userId})-[r:BLOCKED]->(b:User {id:$targetId})
       DELETE r`,
      { userId, targetId },
      tx,
    );

    return { message: 'User unblocked successfully' };
  }

  // ----- Cursor-based get friends -----
  async getFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    const queryDB = `
      MATCH (u:User {id:$userId})-[:FRIEND_WITH]->(f:User)
      ${query.cursor ? 'WHERE f.id > $cursor' : ''}
      RETURN f.id as id
      ORDER BY f.id
      LIMIT $limitPlusOne
    `;
    const params: any = { userId, limitPlusOne: int(query.limit + 1) };
    if (query.cursor) params.cursor = query.cursor;

    const res = await this.neo4j.read(queryDB, params);
    const ids = res.records.map((r) => String(r.get('id')));

    const hasNextPage = ids.length > query.limit;
    const pageData = hasNextPage ? ids.slice(0, query.limit) : ids;
    const nextCursor = hasNextPage ? pageData[pageData.length - 1] : null;

    return {
      data: Array.isArray(pageData) ? [...pageData] : [],
      nextCursor,
      hasNextPage,
    };
  }

  // ----- Cursor-based get friend requests -----
  async getFriendRequests(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    const queryDB = `
      MATCH (sender:User)-[:REQUESTED]->(receiver:User {id:$userId})
      ${query.cursor ? 'WHERE sender.id > $cursor' : ''}
      RETURN sender.id as id
      ORDER BY sender.id
      LIMIT $limitPlusOne
    `;
    const params: any = { userId, limitPlusOne: int(query.limit + 1) };
    if (query.cursor) params.cursor = query.cursor;

    const res = await this.neo4j.read(queryDB, params);
    const ids = res.records.map((r) => String(r.get('id')));

    const hasNextPage = ids.length > query.limit;
    const pageData = hasNextPage ? ids.slice(0, query.limit) : ids;
    const nextCursor = hasNextPage ? pageData[pageData.length - 1] : null;

    return {
      data: Array.isArray(pageData) ? [...pageData] : [],
      nextCursor,
      hasNextPage,
    };
  }

  // ----- Recommend friends (top 10 by mutual friends) -----
  async recommendFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<
    CursorPageResponse<{
      id: string;
      mutualFriends: number;
      mutualFriendIds: string[];
    }>
  > {
    const queryDB = `
   MATCH (u:User {id:$userId})-[:FRIEND_WITH]-(f:User)-[:FRIEND_WITH]-(rec:User)
    WHERE 
      u <> rec
      AND NOT (u)-[:FRIEND_WITH]-(rec)
      AND NOT (u)-[:REQUESTED]->(rec)
      AND NOT (rec)-[:REQUESTED]->(u)
      AND NOT (u)-[:BLOCKED]->(rec)
      AND NOT (rec)-[:BLOCKED]->(u)
      ${query.cursor ? 'AND rec.id > $cursor' : ''}
    WITH rec, COLLECT(DISTINCT f.id) AS mutualFriendIds
    RETURN DISTINCT rec.id AS id, SIZE(mutualFriendIds) AS mutualFriends, mutualFriendIds
    ORDER BY mutualFriends DESC, rec.id ASC
    LIMIT $limitPlusOne
  `;

    const params: any = { userId, limitPlusOne: int(query.limit + 1) };
    if (query.cursor) params.cursor = query.cursor;

    const res = await this.neo4j.read(queryDB, params);

    const records = res.records.map((r) => ({
      id: r.get('id'),
      mutualFriends: r.get('mutualFriends').toNumber(),
      mutualFriendIds: r.get('mutualFriendIds'), // array of strings
    }));

    const hasNextPage = records.length > query.limit;
    const pageData = hasNextPage ? records.slice(0, query.limit) : records;
    const nextCursor = hasNextPage ? pageData[pageData.length - 1].id : null;

    return {
      data: Array.isArray(pageData) ? [...pageData] : [],
      nextCursor,
      hasNextPage,
    };
  }
}
