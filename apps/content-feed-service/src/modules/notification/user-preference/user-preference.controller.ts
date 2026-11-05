import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { UserPreferenceService } from "./user-preference.service";
import { GetUserPreferenceDto, UpdateUserPreferenceDto } from "@repo/dtos";

@Controller()
export class UserPreferenceController {
  constructor(private readonly userPreferenceService: UserPreferenceService) {}

  @TcpMessagePattern("get_user_preference")
  async getUserPreference(@Payload() payload: GetUserPreferenceDto) {
    return this.userPreferenceService.getUserPreferences(payload.userId);
  }

  @TcpMessagePattern("update_user_preference")
  async updateUserPreference(@Payload() payload: UpdateUserPreferenceDto) {
    // we omit the userId when passing to partial update
    const { userId, ...prefs } = payload;
    return this.userPreferenceService.setUserPreferences(userId, prefs as any);
  }
}
