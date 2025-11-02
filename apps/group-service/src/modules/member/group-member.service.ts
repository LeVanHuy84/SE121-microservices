import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { Repository } from 'typeorm';

@Injectable()
export class GroupMemberService {
  constructor(
    @InjectRepository(GroupMember)
    private readonly repo: Repository<GroupMember>,
  ) {}

  async findMember(userId: string, groupId: string): Promise<GroupMember> {
    const member = await this.repo.findOne({ where: { userId, groupId } });
    if (!member) throw new Error('Member not found');

    // Cache member
    return member;
  }
}

// import { Injectable } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import Redis from 'ioredis';
// import { GroupMember } from 'src/entities/group-member.entity';
// import { InjectRedis } from '@nestjs-modules/ioredis';

// @Injectable()
// export class GroupMemberService {
//   constructor(
//     @InjectRepository(GroupMember)
//     private readonly repo: Repository<GroupMember>,
//     @InjectRedis() private readonly redis: Redis,
//   ) {}

//   private getCacheKey(userId: string, groupId: string) {
//     return `group:member:${groupId}:${userId}`;
//   }

//   async findMember(userId: string, groupId: string): Promise<GroupMember> {
//     const cacheKey = this.getCacheKey(userId, groupId);

//     // 1️⃣ Try get from cache
//     const cached = await this.redis.get(cacheKey);
//     if (cached) return JSON.parse(cached);

//     // 2️⃣ Otherwise, get from DB
//     const member = await this.repo.findOne({ where: { userId, groupId } });
//     if (!member) throw new Error('Member not found');

//     // 3️⃣ Cache result
//     await this.redis.set(cacheKey, JSON.stringify(member), 'EX', 60 * 5); // TTL 5 phút

//     return member;
//   }

//   async invalidateMemberCache(userId: string, groupId: string): Promise<void> {
//     await this.redis.del(this.getCacheKey(userId, groupId));
//   }
// }
