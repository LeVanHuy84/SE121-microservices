import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { Media } from 'src/entities/media.entity';
import { Outbox } from 'src/entities/outbox.entity';
import { EventStoreService } from 'src/event-store/event-store.service';
import { SagaOrchestratorService } from 'src/saga-orchestrator/saga-orchestrator.service';
import { Repository } from 'typeorm';


@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(Media) private readonly mediaRepo: Repository<Media>,
    @InjectRepository(Outbox) private readonly outboxRepo: Repository<Outbox>,
    private readonly cloudinary: CloudinaryService,
    private readonly eventStore: EventStoreService,
    private readonly saga: SagaOrchestratorService
  ) {}

  async upload(userId: string, folder: string, type: 'image'|'video') {
    // detect type roughly from buffer? better pass resource_type from controller.
    const publicId = `${folder}/${userId}`;

    // create DB media record (status UPLOADING)
    const media = this.mediaRepo.create({
      userId,
      publicId,
      url: '', // fill on result or later
      type: type,
      status: 'UPLOADING',
    });
    const saved = await this.mediaRepo.save(media);

    // append event (event sourcing): MediaUploadRequested
    await this.eventStore.append('Media', saved.id, 'MediaUploadRequested', {
      userId,
      publicId,
    });

    // persist outbox for handler to publish (so other services can react)
    await this.outboxRepo.save(
      this.outboxRepo.create({
        eventType: 'MediaUploadRequested',
        payload: { mediaId: saved.id, userId, publicId },
      })
    );

    return saved;
  }
  async performUpload(
    mediaId: string,
    buffer: Buffer,
    resourceType: 'image' | 'video',
    notificationUrl?: string
  ) {
    const media = await this.mediaRepo.findOneBy({ id: mediaId });
    if (!media) throw new Error('Media not found');

    // upload
    const options: any = {
      resource_type: resourceType,
      public_id: media.publicId,
    };
    if (resourceType === 'video') {
      options.eager = [
        { width: 320, height: 180, crop: 'fill' }, // thumbnail
      ];
      options.notification_url = notificationUrl;
    }

    const result = await this.cloudinary.uploadFile(
      buffer,
      `app/${media.userId}`,
      options
    );

    // update media
    media.url = result.secure_url || result.url;
    media.type = resourceType;
    media.format = result.format;
    media.size = result.bytes;
    if (resourceType === 'video' && result.duration)
      media.duration = Math.floor(result.duration);
    media.status = resourceType === 'video' ? 'UPLOADED' : 'READY';
    await this.mediaRepo.save(media);

    // event store
    await this.eventStore.append('Media', media.id, 'MediaUploaded', {
      result,
      mediaId: media.id,
    });

    // outbox - publish higher-level events
    await this.outboxRepo.save(
      this.outboxRepo.create({
        eventType: resourceType === 'video' ? 'VideoUploaded' : 'ImageUploaded',
        payload: {
          mediaId: media.id,
          url: media.url,
          userId: media.userId,
          publicId: media.publicId,
        },
      })
    );

    // if video start saga orchestration
    if (resourceType === 'video') {
      await this.saga.startVideoSaga(media);
    }

    return media.url;
  }

  async markProcessed(
    publicId: string,
    status: 'READY' | 'FAILED',
    secureUrl?: string
  ) {
    const media = await this.mediaRepo.findOneBy({ publicId });
    if (!media) return null;
    media.status = status;
    if (secureUrl) media.url = secureUrl;
    await this.mediaRepo.save(media);

    // event store
    await this.eventStore.append('Media', media.id, 'MediaProcessed', {
      status,
      mediaId: media.id,
    });

    // outbox publish
    await this.outboxRepo.save(
      this.outboxRepo.create({
        eventType: 'VideoProcessed',
        payload: { mediaId: media.id, status: media.status, url: media.url },
      })
    );

    // optionally notify saga orchestrator to move next state
    await this.saga.onMediaProcessed(media);

    return media;
  }
}
