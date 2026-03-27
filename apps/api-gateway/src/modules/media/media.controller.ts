import {
  Controller,
  Inject,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import { lastValueFrom } from 'rxjs';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('media')
export class MediaController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.MEDIA_SERVICE)
    private readonly mediaClient: ClientProxy
  ) {}

  private inferMediaType(
    mimeType?: string
  ): 'image' | 'video' | 'audio' | 'file' {
    if (mimeType?.startsWith('image/')) return 'image';
    if (mimeType?.startsWith('audio/')) return 'audio';
    if (mimeType?.startsWith('video/')) return 'video';
    return 'file';
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUserId() userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { folder?: string; type?: 'image' | 'video' | 'audio' | 'file' }
  ) {
    if (!file) {
      return { message: 'File is required' };
    }

    return lastValueFrom(
      this.mediaClient.send('upload', {
        file: file.buffer,
        userId,
        folder: body.folder || 'chat-attachments',
        type: body.type || this.inferMediaType(file.mimetype),
        mimeType: file.mimetype,
        fileName: file.originalname,
        size: file.size,
      })
    );
  }
}
