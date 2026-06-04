import { Controller, Inject } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';

import { UserService } from './user.service';
import { UserRecommendationService } from './recommendation/user-recommendation.service';

import { CreateUserDTO, UpdateUserDTO } from '@repo/dtos';
import { firstValueFrom } from 'rxjs';

@Controller()
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userRecommendationService: UserRecommendationService,
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
    const relation: any = await firstValueFrom(
      this.socialClient.send('get_relationship_status', {
        userId: data.userId,
        targetId: data.targetId,
      })
    );

    // 4️⃣ Kiểm tra quyền riêng tư (Privacy) của Profile
    const profileVisibility = profile.privacySettings?.profileVisibility || 'PUBLIC';
    let shouldStripProfile = false;

    if (profileVisibility === 'PRIVATE') {
      shouldStripProfile = true;
    } else if (profileVisibility === 'FRIENDS' && relation?.status !== 'FRIEND') {
      shouldStripProfile = true;
    }

    let finalProfile = profile;
    if (shouldStripProfile) {
      finalProfile = {
        ...profile,
        bio: null,
        location: null,
        jobTitle: null,
        company: null,
        school: null,
        interests: [],
      } as any;
    }

    return { ...finalProfile, relation };
  }

  @MessagePattern('updateUser')
  async update(@Payload() data: { id: string; updateUserDto: UpdateUserDTO }) {
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

  @MessagePattern('searchUserIds')
  async searchUserIds(@Payload() data: { ids: string[]; search: string; limit?: number }) {
    return this.userService.searchUserIds(data.ids, data.search, data.limit);
  }

  @MessagePattern('getBaseUsersBatch')
  async getBaseUserBatch(@Payload() ids: string[]) {
    return this.userService.getBaseUsersBatch(ids);
  }

  @MessagePattern('getProfileRecommendationCandidates')
  async getProfileRecommendationCandidates(
    @Payload() data: { userId: string; limit?: number },
  ) {
    return this.userRecommendationService.getProfileRecommendationCandidates(
      data.userId,
      data.limit,
    );
  }
}
