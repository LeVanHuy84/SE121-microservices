import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";

import { UserService } from "./user.service";

import { CreateUserDTO, UpdateUserDTO } from "@repo/dtos";

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @TcpMessagePattern("createUser")
  async create(@Payload() createUserDto: CreateUserDTO) {
    return this.userService.create(createUserDto);
  }

  @TcpMessagePattern("findAllUser")
  async findAll() {
    return this.userService.findAll();
  }

  @TcpMessagePattern("findOneUser")
  async findOne(@Payload() data: { userId: string; targetId: string }) {
    const profile = await this.userService.findOne(data.targetId);

    // Self profile gets a SELF relation
    if (data.userId === data.targetId) {
      return { ...profile, relation: { status: "SELF" } };
    }

    // Return profile raw (privacy stripping is now handled at Gateway/BFF)
    return profile;
  }

  @TcpMessagePattern("updateUser")
  async update(@Payload() data: { id: string; updateUserDto: UpdateUserDTO }) {
    return this.userService.update(data.id, data.updateUserDto);
  }

  @TcpMessagePattern("removeUser")
  async remove(@Payload() id: string) {
    return this.userService.remove(id);
  }

  @TcpMessagePattern("getUsersBatch")
  async getUsersBatch(@Payload() ids: string[]) {
    return this.userService.getUsersBatch(ids);
  }

  @TcpMessagePattern("searchUserIds")
  async searchUserIds(
    @Payload() data: { ids: string[]; search: string; limit?: number },
  ) {
    return this.userService.searchUserIds(data.ids, data.search, data.limit);
  }

  @TcpMessagePattern("getBaseUsersBatch")
  async getBaseUserBatch(@Payload() ids: string[]) {
    return this.userService.getBaseUsersBatch(ids);
  }

  @TcpMessagePattern("getProfileRecommendationCandidates")
  async getProfileRecommendationCandidates(
    @Payload() data: { userId: string; limit?: number },
  ) {
    return this.userService.getProfileRecommendationCandidates(
      data.userId,
      data.limit,
    );
  }
}
