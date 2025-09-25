import { Controller, Inject } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';

import { UserService } from './user.service';

import { CreateUserDTO, UpdateUserDTO } from '@repo/dtos';
import { firstValueFrom } from 'rxjs';



@Controller()
export class UserController {
  constructor(
    private readonly userService: UserService,
    @Inject('SOCIAL_SERVICE') private readonly socialClient
  ) {}

  @MessagePattern('createUser')
  async create(@Payload() createUserDto: CreateUserDTO) {
    return this.userService.create(createUserDto);
  }

  @MessagePattern('findAllUser')
  async findAll() {
    return this.userService.findAll();
  }

  @MessagePattern('findOneUser')
  async findOne(@Payload() data: { userId: string; targetId: string }) {
    const profile = await this.userService.findOne(data.targetId);

    if (data.userId === data.targetId) {
      return { ...profile, relation: { status: 'SELF' } };
    }

    // 3️⃣ Lấy trạng thái quan hệ từ Social Service
    const relation = await firstValueFrom(
      this.socialClient.send('get_relationship_status', {
        userId: data.userId,
        targetId: data.targetId,
      })
    );

    return { ...profile, relation };
  }

  @MessagePattern('updateUser')
  async update(
    @Payload()
    data: {
      id: string;
      updateUserDto: UpdateUserDTO;
    }
  ) {
    return this.userService.update(data.id, data.updateUserDto);
  }

  @MessagePattern('removeUser')
  async remove(@Payload() id: string) {
    return this.userService.remove(id);
  }

  @MessagePattern('getUsersBatch')
  async getUsersBatch(@Payload() ids: string[]) {
    return this.userService.getUsersBatch(ids);
  }
}
