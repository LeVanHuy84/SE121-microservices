import {
  Controller,
  Inject
} from '@nestjs/common';
import { ClientProxy, MessagePattern, Payload } from '@nestjs/microservices';
import { ImagesService } from './images.service';

@Controller()
export class ImagesController {
  constructor(
    @Inject('USER_SERVICE') private readonly userClient: ClientProxy,
    private readonly imageService: ImagesService
  ) {}

  @MessagePattern('upload_avatar')
  async updateAvatar(@Payload() data: { file: Buffer; userId: string }) {
    console.log(data.file.buffer);
    const url = await this.imageService.updateImage(
      Buffer.from(data.file),
      data.userId,
      'avatars'
    );
    return this.userClient.send('updateUser', {
      id: data.userId,
      updateUserDto: { avatarUrl: url },
    });
  }

  @MessagePattern('upload_cover_image')
  async updateCoverImage(@Payload() data: { file: Buffer; userId: string }) {
    console.log(data.file.buffer);
    const url = await this.imageService.updateImage(
      Buffer.from(data.file),
      data.userId,
      'cover_images'
    );
    return this.userClient.send('updateUser', {
      id: data.userId,
      updateUserDto: { coverImageUrl: url },
    });
  }
}
