import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";

import { UserService } from "./user.service";

import { CreateUserDTO, UpdateUserDTO } from "@repo/dtos";

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @MessagePattern("createUser")
  async create(@Payload() createUserDto: CreateUserDTO) {
    return this.userService.create(createUserDto);
  }

  @MessagePattern("findAllUser")
  async findAll() {
    return this.userService.findAll();
  }

  @MessagePattern("findOneUser")
  async findOne(@Payload() data: { userId: string; targetId: string }) {
    const profile = await this.userService.findOne(data.targetId);

    // Self profile gets a SELF relation
    if (data.userId === data.targetId) {
      return { ...profile, relation: { status: "SELF" } };
    }

    // Return profile raw (privacy stripping is now handled at Gateway/BFF)
    return profile;
  }

  @MessagePattern("updateUser")
  async update(@Payload() data: { id: string; updateUserDto: UpdateUserDTO }) {
    return this.userService.update(data.id, data.updateUserDto);
  }

  @MessagePattern("removeUser")
  async remove(@Payload() id: string) {
    return this.userService.remove(id);
  }

  @MessagePattern("getUsersBatch")
  async getUsersBatch(@Payload() ids: string[]) {
    return this.userService.getUsersBatch(ids);
  }

  @MessagePattern("searchUserIds")
  async searchUserIds(
    @Payload() data: { ids: string[]; search: string; limit?: number },
  ) {
    return this.userService.searchUserIds(data.ids, data.search, data.limit);
  }

  @MessagePattern("getBaseUsersBatch")
  async getBaseUserBatch(@Payload() ids: string[]) {
    return this.userService.getBaseUsersBatch(ids);
  }

  @MessagePattern("getProfileRecommendationCandidates")
  async getProfileRecommendationCandidates(
    @Payload() data: { userId: string; limit?: number },
  ) {
    return this.userService.getProfileRecommendationCandidates(
      data.userId,
      data.limit,
    );
  }
}
