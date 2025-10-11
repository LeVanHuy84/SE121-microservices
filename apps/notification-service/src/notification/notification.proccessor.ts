// src/notification/notification.processor.ts
import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { NotificationService } from './notification.service';
import { Injectable } from '@nestjs/common';

@Processor('notification')
@Injectable()
export class NotificationProcessor {
  constructor(private readonly notificationService: NotificationService) {}

  @Process('send')
  async handleSend(job: Job) {
    const id = job.data.id;
    const notification = await this.notificationService.findById(id);
    if (!notification) return;
    await this.notificationService.publishToChannels(notification as any);
  }
}
