import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceToken } from '../mongo/schema/device-token.schema';
import { RegisterDeviceTokenDto } from './dto/device-token.dto';

@Injectable()
export class DeviceTokenService {
  private readonly logger = new Logger(DeviceTokenService.name);

  constructor(
    @InjectModel(DeviceToken.name)
    private deviceTokenModel: Model<DeviceToken>
  ) {}


    async registerToken(dto: RegisterDeviceTokenDto): Promise<DeviceToken> {
    try {
      const provider = dto.provider ?? 'fcm';

      // Đảm bảo token này chỉ thuộc về user hiện tại
      // Xoá token này khỏi tất cả các user khác (xảy ra khi đổi acc trên cùng 1 máy)
      await this.deviceTokenModel.deleteMany({
        token: dto.token,
        userId: { $ne: dto.userId },
      });

      const tokenDoc = await this.deviceTokenModel.findOneAndUpdate(
        {
          userId: dto.userId,
          token: dto.token,
        },
        {
          $set: {
            platform: dto.platform,
            provider,
            appId: dto.appId,
            deviceId: dto.deviceId,
            deviceName: dto.deviceName,
            lastUsed: new Date(),
            isActive: true,
          },
        },
        {
          new: true,
          upsert: true,
        }
      );

      this.logger.log(`Registered/Updated device token for user ${dto.userId}`);
      return tokenDoc;
    } catch (error) {
      this.logger.error('Error registering device token', error);
      throw error;
    }
  }

  async removeToken(userId: string, token: string): Promise<boolean> {
    try {
      const result = await this.deviceTokenModel.deleteOne({
        userId,
        token,
      });
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error('Error removing device token', error);
      return false;
    }
  }

  async getActiveTokensByUserId(
    userId: string
  ): Promise<
    {
      token: string;
      platform: string;
      provider: 'fcm';
      appId?: string;
      deviceId?: string;
      deviceName?: string;
    }[]
  > {
    try {
      const tokens = await this.deviceTokenModel
        .find({
          userId,
          isActive: true,
          provider: 'fcm',
        })
        .select('token platform provider appId deviceId deviceName')
        .lean();

      return tokens.map((t) => ({
        token: t.token,
        platform: t.platform,
        provider: 'fcm',
        appId: t.appId,
        deviceId: t.deviceId,
        deviceName: t.deviceName,
      }));
    } catch (error) {
      this.logger.error('Error getting active tokens', error);
      return [];
    }
  }

  async markTokensAsInvalid(tokens: string[]): Promise<void> {
    try {
      await this.deviceTokenModel.updateMany(
        { token: { $in: tokens } },
        { $set: { isActive: false } }
      );
      this.logger.log(`Marked ${tokens.length} tokens as invalid`);
    } catch (error) {
      this.logger.error('Error marking tokens as invalid', error);
    }
  }

  async getAllTokensByUserId(userId: string): Promise<DeviceToken[]> {
    return this.deviceTokenModel.find({ userId }).lean();
  }

  async removeAllUserTokens(userId: string): Promise<number> {
    const result = await this.deviceTokenModel.deleteMany({ userId });
    return result.deletedCount;
  }
}
