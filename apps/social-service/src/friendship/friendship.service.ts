/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { Transaction } from 'neo4j-driver';
import { Neo4jService } from 'src/neo4j/neo4j.service';

@Injectable()
export class FriendshipService {
  constructor(private readonly neo4j: Neo4jService) {}
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
    if (r.get('hasRequestedOut')) return { status: 'REQUESTED_OUT' }; // mình gửi cho nó
    if (r.get('hasRequestedIn')) return { status: 'REQUESTED_IN' }; // nó gửi cho mình

    return { status: 'NONE' };
  }

  async sendFriendRequest(
    databaseOrTransaction: string | Transaction,
    userId: string,
    targetId: string,
  ) {
    await this.neo4j.write(
      `MERGE (u:User {id:$userId}) MERGE (t:User {id:$targetId}) MERGE (u)-[:REQUESTED]->(t)`,
      { userId, targetId },
      databaseOrTransaction,
    );
    return { success: true };
  }
  async acceptFriendRequest(
    databaseOrTransaction: string | Transaction,
    userId: string,
    requesterId: string,
  ) {
    await this.neo4j.write(
      `MATCH (r:User {id:$requesterId})-[req:REQUESTED]->(u:User {id:$userId}) DELETE req MERGE (u)-[:FRIEND_WITH {since:datetime(), sentimentScore:0}]->(r) MERGE (r)-[:FRIEND_WITH {since:datetime(), sentimentScore:0}]->(u)`,
      { userId, requesterId },
      databaseOrTransaction,
    );
    return { success: true };
  }
  async removeFriend(userId: string, friendId: string) {
    return this.neo4j.write(
      `MATCH (u:User {id:$userId})-[f:FRIEND_WITH]-(fr:User {id:$friendId}) DELETE f`,
      { userId, friendId },
    );
  }

  async getFriends(userId: string) {
    const result = await this.neo4j.read(
      `MATCH (u:User {id:$userId})-[:FRIEND_WITH]-(f:User) RETURN f.id as id`,
      { userId },
    );
    const records = result.records || result;
    return records.map((r) => r.get('id'));
  }

  async recommendFriends(userId: string) {
    const res = await this.neo4j.read(
      `MATCH (u:User {id:$userId})-[:FRIEND_WITH]-(f:User)-[:FRIEND_WITH]-(rec:User) WHERE NOT (u)-[:FRIEND_WITH]-(rec) AND u <> rec RETURN rec.id as id, COUNT(f) as mutualFriends ORDER BY mutualFriends DESC LIMIT 10`,
      { userId },
    );
    const records = res.records || res;
    return records.map((r) => ({
      id: r.get('id'),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      mutualFriends: r.get('mutualFriends').toNumber(),
    }));
  }
  async updateFriendshipSentiment(
    userId: string,
    friendId: string,
    score: number,
  ) {
    return this.neo4j.write(
      `MATCH (u:User {id:$userId})-[f:FRIEND_WITH]-(fr:User {id:$friendId}) SET f.sentimentScore = coalesce(f.sentimentScore,0) + $score RETURN f`,
      { userId, friendId, score },
    );
  }

  async blockUser(
    userId: string,
    targetId: string,
    databaseOrTransaction: string | Transaction,
  ) {
    return this.neo4j.write(
      `MATCH (a:User {id: $userId}), (b:User {id: $targetId})
     OPTIONAL MATCH (a)-[r:FRIEND_WITH|REQUESTED|FOLLOWS]-(b)
     DELETE r
     MERGE (a)-[:BLOCKED]->(b)`,
      { userId, targetId },
      databaseOrTransaction,
    );
  }
  async unblockUser(userId: string, targetId: string) {
    return this.neo4j.write(
      `MATCH (a:User {id: $userId})-[r:BLOCKED]->(b:User {id: $targetId}) DELETE r`,
      { userId, targetId },
    );
  }

  async getFriendIds(userId: string, limit?: number) {
    const query = `
      MATCH (u:User {id: $userId})- [r:FRIEND_WITH]-> (f:User)
      RETURN f.id as id, r.since as since
      ORDER BY r.since DESC
      ${limit ? 'LIMIT $limit' : ''}
    `;
    const result = await this.neo4j.read(query, { userId, limit });
    const records = result.records || result;

    return records.map((r) => r.get('id'));
  }
}
