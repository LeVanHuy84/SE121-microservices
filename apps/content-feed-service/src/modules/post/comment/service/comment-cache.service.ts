import { InjectRedis } from "@nestjs-modules/ioredis";
import { Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { Comment } from "src/entities/comment.entity";
import { Repository, In } from "typeorm";

@Injectable()
export class CommentCacheService {
  private readonly COMMENT_TTL = 5; // 5 giây (comment đơn)
  private readonly COMMENT_LIST_TTL = 5; // 1 phút (danh sách comment)

  constructor(@InjectRedis() private readonly redis: Redis) {}

  /** 🧩 Key comment đơn */
  private commentKey(id: string): string {
    return `comment:${id}`;
  }

  /** 🧩 Key danh sách comment */
  private listKey(rootId?: string, parentId?: string | null): string {
    if (parentId) return `comment:list:parent:${parentId}`;
    if (rootId && !parentId) return `comment:list:root:${rootId}`;
    return "comment:list:unknown";
  }

  /** 🔹 Lấy cache comment đơn */
  async getCachedComment(id: string): Promise<Comment | null> {
    const json = await this.redis.get(this.commentKey(id));
    return json ? (JSON.parse(json) as Comment) : null;
  }

  /** 🔹 Lưu cache comment đơn */
  async setCachedComment(comment: Comment): Promise<void> {
    await this.redis.set(
      this.commentKey(comment.id),
      JSON.stringify(comment),
      "EX",
      this.COMMENT_TTL,
    );
  }

  /** 🔹 Batch get comments (cache + DB fallback) */
  async getCachedCommentsBatch(
    ids: string[],
    repo: Repository<Comment>,
  ): Promise<Comment[]> {
    if (!ids.length) return [];
    const keys = ids.map((id) => this.commentKey(id));
    const cached = await this.redis.mget(keys);

    const result: Comment[] = [];
    const missingIds: string[] = [];

    cached.forEach((c, i) => {
      if (c) result.push(JSON.parse(c));
      else missingIds.push(ids[i]);
    });

    if (missingIds.length) {
      const fresh = await repo.find({
        where: { id: In(missingIds) },
        relations: ["commentStat"],
      });
      if (fresh.length) {
        const pipeline = this.redis.pipeline();
        for (const c of fresh) {
          pipeline.set(
            this.commentKey(c.id),
            JSON.stringify(c),
            "EX",
            this.COMMENT_TTL,
          );
        }
        await pipeline.exec();
      }
      result.push(...fresh);
    }

    // Giữ thứ tự theo ids gốc
    return ids.map((id) => result.find((c) => c.id === id)!).filter(Boolean);
  }

  /** 🔹 Lấy cache danh sách comment */
  async getCachedCommentList(
    rootId?: string,
    parentId?: string | null,
  ): Promise<Comment[] | null> {
    const key = this.listKey(rootId, parentId);
    const json = await this.redis.get(key);
    return json ? (JSON.parse(json) as Comment[]) : null;
  }

  /** 🔹 Lưu cache danh sách comment */
  async setCachedCommentList(
    comments: Comment[],
    rootId?: string,
    parentId?: string | null,
  ): Promise<void> {
    const key = this.listKey(rootId, parentId);
    await this.redis.set(
      key,
      JSON.stringify(comments),
      "EX",
      this.COMMENT_LIST_TTL,
    );
  }

  /** 🔹 Xoá cache khi cập nhật/xoá comment */
  async invalidateComment(
    id: string,
    rootId?: string,
    parentId?: string | null,
  ): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.del(this.commentKey(id));
    pipeline.del(this.listKey(rootId, parentId));
    await pipeline.exec();
  }
}
