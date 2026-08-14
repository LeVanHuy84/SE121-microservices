import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  OneToMany,
} from "typeorm";
import { FinalDecision, Severity, TargetType } from "@repo/dtos";
import { ModerationAppeal } from "./moderation-appeal.entity";

@Entity("content_moderations")
@Index(["targetId", "targetType"])
@Index(["userId"])
export class ContentModeration {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("varchar", { name: "user_id" })
  userId: string;

  @Column("uuid", { name: "target_id" })
  targetId: string;

  @Column({ type: "enum", enum: TargetType, name: "target_type" })
  targetType: TargetType;

  @Column({ name: "is_violation", default: true })
  isViolation: boolean;

  @Column({ type: "jsonb", nullable: true })
  violations: {
    category: string;
    reason: string;
  }[];

  @Column({
    type: "enum",
    enum: Severity,
    name: "max_severity",
    default: Severity.NONE,
  })
  maxSeverity: Severity;

  @Column({ type: "float", nullable: true })
  confidence: number;

  @Column("varchar", { name: "display_message", nullable: true })
  displayMessage: string;

  @Column({
    name: "final_decision",
    type: "enum",
    enum: FinalDecision,
    nullable: true,
  })
  finalDecision?: FinalDecision;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @OneToMany(() => ModerationAppeal, (appeal) => appeal.moderation)
  appeals: ModerationAppeal[];
}
