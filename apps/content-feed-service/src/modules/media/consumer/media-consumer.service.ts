import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository, EntityManager } from "typeorm";
import { CloudinaryService } from "../cloudinary/cloudinary.service";
import { Media } from "../entities/media.entity";

@Injectable()
export class MediaConsumerService {
  private readonly logger = new Logger(MediaConsumerService.name);

  constructor(
    private readonly cloudinary: CloudinaryService,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
  ) {}

  // helper để lấy repo đúng context
  private getRepo(manager?: EntityManager): Repository<Media> {
    return manager ? manager.getRepository(Media) : this.mediaRepo;
  }

  async deleteMedia(
    items: { publicId: string; resourceType?: "image" | "video" | "raw" }[],
    manager?: EntityManager,
  ) {
    const repo = this.getRepo(manager);

    for (const item of items) {
      const resourceType = item.resourceType ?? "image";

      // external call → không nằm trong transaction
      await this.cloudinary.deleteFile(item.publicId, resourceType);

      this.logger.log(
        `Deleted media publicId=${item.publicId} resourceType=${resourceType}`,
      );
    }

    if (items.length) {
      await repo.delete({
        publicId: In(items.map((item) => item.publicId)),
      });
    }
  }

  async assignContentId(
    contentId: string,
    items: {
      publicId: string;
      url?: string;
      type?: "image" | "video" | "audio" | "file";
    }[],
    manager?: EntityManager,
  ) {
    if (!items.length) return;

    const repo = this.getRepo(manager);

    const publicIds = items.map((item) => item.publicId);

    const existing = await repo.find({
      where: { publicId: In(publicIds) },
    });

    const existingMap = new Map(
      existing.map((media) => [media.publicId, media]),
    );

    const toSave: Media[] = [];

    for (const item of items) {
      const found = existingMap.get(item.publicId);

      if (found) {
        found.contentId = contentId;
        found.status = "READY";

        if (item.url) found.url = item.url;
        if (item.type) found.type = item.type;

        toSave.push(found);
        continue;
      }

      toSave.push(
        repo.create({
          publicId: item.publicId,
          contentId,
          url: item.url,
          type: item.type ?? "image",
          status: "READY",
        }),
      );
    }

    await repo.save(toSave);

    this.logger.log(
      `Assigned contentId=${contentId} to ${toSave.length} media items`,
    );
  }
}
