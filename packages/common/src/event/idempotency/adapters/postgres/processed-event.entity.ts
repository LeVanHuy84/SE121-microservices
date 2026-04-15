import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('processed_events')
export class PostgresProcessedEvent {
  @PrimaryColumn()
  eventId: string;

  @Column({ default: false })
  done: boolean;
}
