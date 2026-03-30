export class RegisterDeviceTokenDto {
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceId?: string;
  deviceName?: string;
}

export class RemoveDeviceTokenDto {
  userId: string;
  token: string;
}
