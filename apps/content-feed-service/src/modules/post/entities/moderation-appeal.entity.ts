import { AppealStatus } from "@repo/dtos";
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { ContentModeration } from "./content-moderation.entity";

@Entity("moderation_appeals")
export class ModerationAppeal {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "moderation_id" })
  moderationId: string;

  @Column({ name: "user_id" })
  userId: string;

  @Column("text")
  reason: string;

  @Column({
    type: "enum",
    enum: AppealStatus,
    default: AppealStatus.PENDING,
  })
  status: AppealStatus;

  @Column({ name: "reviewed_by", nullable: true })
  reviewedBy: string;

  @Column({ name: "review_note", nullable: true })
  reviewNote: string;

  @Column({ name: "reviewed_at", nullable: true })
  reviewedAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => ContentModeration, { onDelete: "CASCADE" })
  @JoinColumn({ name: "moderation_id" })
  moderation: ContentModeration;
}
