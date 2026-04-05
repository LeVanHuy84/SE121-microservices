import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceToken } from 'src/mongo/schema/device-token.schema';
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
      const existingToken = await this.deviceTokenModel.findOne({
        userId: dto.userId,
        token: dto.token,
        provider,
      });

      if (existingToken) {
        // Update existing token
        existingToken.lastUsed = new Date();
        existingToken.isActive = true;
        existingToken.platform = dto.platform;
        existingToken.provider = provider;
        if (dto.appId) existingToken.appId = dto.appId;
        if (dto.deviceId) existingToken.deviceId = dto.deviceId;
        if (dto.deviceName) existingToken.deviceName = dto.deviceName;
        await existingToken.save();
        return existingToken;
      }

      // Create new token
      const newToken = await this.deviceTokenModel.create({
        userId: dto.userId,
        token: dto.token,
        platform: dto.platform,
        provider,
        appId: dto.appId,
        deviceId: dto.deviceId,
        deviceName: dto.deviceName,
        lastUsed: new Date(),
        isActive: true,
      });

      this.logger.log(`Registered new device token for user ${dto.userId}`);
      return newToken;
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
  ): Promise<{ token: string; platform: string; provider: 'fcm' }[]> {
    try {
      const tokens = await this.deviceTokenModel
        .find({
          userId,
          isActive: true,
          provider: 'fcm',
        })
        .select('token platform provider')
        .lean();

      return tokens.map((t) => ({
        token: t.token,
        platform: t.platform,
        provider: 'fcm',
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
