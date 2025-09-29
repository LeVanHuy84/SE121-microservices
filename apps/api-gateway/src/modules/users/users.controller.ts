import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { Public } from 'src/common/decorators/public.decorator';
import { CreateUserDTO, UpdateUserDTO, UserResponseDTO } from '@repo/dtos';
import { Observable } from 'rxjs';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
@Controller('users')
export class UsersController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.USER_SERVICE)
    private client: ClientProxy
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
  update(
    @CurrentUserId() id: string,
    @Body() updateUserDto: UpdateUserDTO
  ) {
    return this.client.send('updateUser', {
      id,
      updateUserDto,
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.client.send('removeUser', id);
  }
}
