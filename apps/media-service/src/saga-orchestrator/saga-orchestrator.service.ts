// saga.orchestrator.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Media } from 'src/entities/media.entity';
import { Saga } from 'src/entities/saga.entity';
import { Repository } from 'typeorm';

@Injectable()
export class SagaOrchestratorService {
  private logger = new Logger(SagaOrchestratorService.name);

  constructor(
    @InjectRepository(Saga) private readonly sagaRepo: Repository<Saga>,
    @InjectRepository(Media) private readonly mediaRepo: Repository<Media>
  ) {}

  async startVideoSaga(media: Media) {
    const saga = this.sagaRepo.create({
      sagaType: 'video_processing',
      state: 'uploaded',
      context: {
        mediaId: media.id,
        publicId: media.publicId,
        userId: media.userId,
      },
    });
    await this.sagaRepo.save(saga);

    // you can schedule timeout checks, or call external services
    this.logger.log('Started saga for video ' + media.id);
    return saga;
  }

  async onMediaProcessed(media: Media) {
    // find saga
    const saga = await this.sagaRepo.findOne({
      where: { context: { mediaId: media.id } } as any,
    });
    if (!saga) return;
    if (media.status === 'READY') {
      saga.state = 'completed';
    } else {
      try {
        saga.state = 'failed';
        // compensation: delete media in cloudinary or mark for cleanup
        await this.mediaRepo.remove(media);
      } catch (error) {
        this.logger.error(
          'Error during compensation for saga ' + saga.id,
          error
        );
      }
    }
    await this.sagaRepo.save(saga);
  }
}
