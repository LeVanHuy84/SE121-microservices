import type { ClerkClient } from '@clerk/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CreateUserDTO, UpdateUserDTO, UserResponseDTO } from '@repo/dtos';
import { lastValueFrom, Observable } from 'rxjs';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { Public } from 'src/common/decorators/public.decorator';
@Controller('users')
export class UsersController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.USER_SERVICE)
    private client: ClientProxy,
    @Inject(MICROSERVICES_CLIENTS.MEDIA_SERVICE)
    private readonly mediaClient: ClientProxy,
    @Inject('ClerkClient')
    private readonly clerkClient: ClerkClient
  ) {}

  @Public()
  @Post()
  create(@Body() createUserDto: CreateUserDTO) {
    return this.client.send('createUser', createUserDto);
  }

  @Get()
  findAll(): Observable<UserResponseDTO[]> {
    return this.client.send<UserResponseDTO[]>('findAllUser', {});
  }

  @Get(':id')
  findOne(@Param('id') targetId: string, @CurrentUserId() userId: string) {
    return this.client.send<UserResponseDTO>('findOneUser', {
      userId,
      targetId,
    });
  }

  @Patch()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatarUrl', maxCount: 1 },
        { name: 'coverImageUrl', maxCount: 1 },
      ],
      {
        limits: {
          fileSize: 2 * 1024 * 1024, // 2MB
        },
      }
    )
  )
  async update(
    @CurrentUserId() id: string,
    @UploadedFiles()
    files: {
      avatarUrl?: Express.Multer.File[];
      coverImageUrl?: Express.Multer.File[];
    },
    @Body() updateUserDto: UpdateUserDTO
  ) {
    if (files?.avatarUrl?.[0]) {
      const multerFile = files.avatarUrl[0];

      const clerkFile = new File(
        [new Uint8Array(multerFile.buffer)],
        multerFile.originalname,
        {
          type: multerFile.mimetype,
        }
      );

      await this.clerkClient.users.updateUserProfileImage(id, {
        file: clerkFile,
      });

      const avatarUrl = await this.clerkClient.users
        .getUser(id)
        .then((user) => user.imageUrl);

      updateUserDto.avatarUrl = avatarUrl;
    }
    if (files?.coverImageUrl?.[0]) {
      const uploaded = await lastValueFrom(
        this.mediaClient.send('upload', {
          file: files.coverImageUrl[0].buffer,
          userId: id,
          folder: 'cover-image',
          type: 'image',
        })
      );
      console.log('Uploaded cover image:', uploaded);
      updateUserDto.coverImage = {
        url: uploaded.url,
        publicId: uploaded.publicId,
      };
    }
    const user = this.client.send('updateUser', {
      id,
      updateUserDto,
    });
    // Update user in Clerk
    await this.clerkClient.users.updateUser(id, {
      firstName: updateUserDto.firstName,
      lastName: updateUserDto.lastName,
    });
    return user;
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.client.send('removeUser', id);
  }
}
