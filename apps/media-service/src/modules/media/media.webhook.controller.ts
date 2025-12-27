import { BadRequestException, Body, Controller, Logger, Post } from '@nestjs/common';
import { MediaService } from './media.service';

type CloudinaryWebhookPayload = {
  public_id?: string;
  secure_url?: string;
  url?: string;
  resource_type?: 'image' | 'video';
  format?: string;
  bytes?: number;
  duration?: number;
  created_at?: string;
  notification_type?: string;
  timestamp?: number | string;
  signature?: string;
};

@Controller('webhook')
export class MediaWebhookController {
  private readonly logger = new Logger(MediaWebhookController.name);

  constructor(private readonly mediaService: MediaService) {}

  @Post('cloudinary')
  async handleCloudinary(@Body() body: CloudinaryWebhookPayload) {
    this.logger.log(
      `Webhook received publicId=${body?.public_id ?? 'missing'} ` +
        `type=${body?.resource_type ?? 'unknown'} ` +
        `notif=${body?.notification_type ?? 'unknown'}`
    );

    if (!body?.public_id) {
      this.logger.warn('Webhook missing public_id');
      throw new BadRequestException('Missing public_id');
    }

    if (body.notification_type && body.notification_type !== 'upload') {
      this.logger.log(`Ignoring notification_type=${body.notification_type}`);
      return { ignored: true };
    }

    const url = body.secure_url || body.url;
    if (!url) {
      this.logger.warn(`Webhook missing url publicId=${body.public_id}`);
      throw new BadRequestException('Missing url');
    }

    const media = await this.mediaService.upsertFromWebhook({
      publicId: body.public_id,
      url,
      type: body.resource_type ?? 'image',
      format: body.format,
      size: body.bytes,
      duration: body.duration ? Math.round(body.duration) : undefined,
      createdAt: body.created_at ? new Date(body.created_at) : undefined,
    });

    this.logger.log(`Webhook upserted mediaId=${media.id} publicId=${media.publicId}`);
    return { id: media.id, publicId: media.publicId };
  }

}
