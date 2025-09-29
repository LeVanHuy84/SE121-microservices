import {
  BadRequestException,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { ImageValidationPipe } from './images.validator';

@Controller('media')
export class MediaController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.MEDIA_SERVICE)
    private readonly mediaClient: ClientProxy
  ) {}

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @UploadedFile(
      new ImageValidationPipe({
        maxSizeMB: 5,
        allowedTypes: ['image/jpeg', 'image/png'],
      })
    )
    file: Express.Multer.File,
    @CurrentUserId() userId: string
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.mediaClient.send('upload_avatar', {
      file: file.buffer,
      userId,
    });
  }

  @Post('cover-image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadCoverImage(
    @UploadedFile(
      new ImageValidationPipe({
        maxSizeMB: 5,
        allowedTypes: ['image/jpeg', 'image/png'],
      })
    )
    file: Express.Multer.File,
    @CurrentUserId() userId: string
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.mediaClient.send('upload_cover_image', {
      file: file.buffer,
      userId,
    });
  }
}
