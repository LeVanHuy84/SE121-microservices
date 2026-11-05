import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { DeviceTokenService } from "./device-token.service";
import {
  RegisterDeviceTokenDto,
  RemoveDeviceTokenDto,
} from "./dto/device-token.dto";

@Controller()
export class DeviceTokenController {
  constructor(private readonly deviceTokenService: DeviceTokenService) {}

  @TcpMessagePattern("register_device_token")
  async registerToken(@Payload() dto: RegisterDeviceTokenDto) {
    return this.deviceTokenService.registerToken(dto);
  }

  @TcpMessagePattern("remove_device_token")
  async removeToken(@Payload() data: RemoveDeviceTokenDto) {
    return this.deviceTokenService.removeToken(data.userId, data.token);
  }

  @TcpMessagePattern("get_user_tokens")
  async getUserTokens(@Payload() userId: string) {
    return this.deviceTokenService.getAllTokensByUserId(userId);
  }

  @TcpMessagePattern("remove_all_user_tokens")
  async removeAllUserTokens(@Payload() userId: string) {
    return this.deviceTokenService.removeAllUserTokens(userId);
  }
}
