import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { DeviceTokenService } from "./device-token.service";
import {
  RegisterDeviceTokenDto,
  RemoveDeviceTokenDto,
} from "./dto/device-token.dto";

@Controller()
export class DeviceTokenController {
  constructor(private readonly deviceTokenService: DeviceTokenService) {}

  @MessagePattern("register_device_token")
  async registerToken(@Payload() dto: RegisterDeviceTokenDto) {
    return this.deviceTokenService.registerToken(dto);
  }

  @MessagePattern("remove_device_token")
  async removeToken(@Payload() data: RemoveDeviceTokenDto) {
    return this.deviceTokenService.removeToken(data.userId, data.token);
  }

  @MessagePattern("get_user_tokens")
  async getUserTokens(@Payload() userId: string) {
    return this.deviceTokenService.getAllTokensByUserId(userId);
  }

  @MessagePattern("remove_all_user_tokens")
  async removeAllUserTokens(@Payload() userId: string) {
    return this.deviceTokenService.removeAllUserTokens(userId);
  }
}
