import { Body, Controller, Headers, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WebhookEvent } from 'src/entities/webhook.entity';
import { MediaService } from 'src/media/media.service';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { EventPattern, Payload } from '@nestjs/microservices';

@Controller('webhook/cloudinary')
export class WebhookController {
  private logger = new Logger(WebhookController.name);
  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookRepo: Repository<WebhookEvent>,
    private readonly mediaService: MediaService,
    private readonly config: ConfigService
  ) {}

  @EventPattern('')
  async handle(
    @Payload() body: any,
    @Payload() signature: string,
    @Payload() ts: string
  ) {
    // Cloudinary has different header names depending on account settings — adjust accordingly.
    const eventId = body.notification_id || body.id || `${Date.now()}`;

    // idempotent check
    const exists = await this.webhookRepo.findOne({ where: { eventId } });
    if (exists) {
      return { ok: true };
    }

    // verify signature (simplified - Cloudinary doc slightly differs)
    const secret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (signature && ts) {
      const computed = crypto
        .createHash('sha1')
        .update(`${ts}${secret}`)
        .digest('hex');
      if (computed !== signature) {
        this.logger.warn('Invalid cloudinary signature');
        return { ok: false };
      }
    }

    // save webhook event
    await this.webhookRepo.save(
      this.webhookRepo.create({ eventId, payload: body })
    );

    // parse body for public_id and status
    const publicId = body.public_id || body.asset_id || body.data?.public_id;
    const status = (body.status || body.event || body.info || '')
      .toLowerCase()
      .includes('ready')
      ? 'READY'
      : 'FAILED';
    const secureUrl = body.secure_url || body.data?.secure_url || body.url;

    await this.mediaService.markProcessed(
      publicId,
      status === 'READY' ? 'READY' : 'FAILED',
      secureUrl
    );

    return { ok: true };
  }
}
