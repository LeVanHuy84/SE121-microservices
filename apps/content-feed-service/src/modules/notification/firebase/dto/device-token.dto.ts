export class RegisterDeviceTokenDto {
  userId: string;
  token: string;
  platform: "ios" | "android" | "web";
  provider?: "fcm";
  appId?: string;
  deviceId?: string;
  deviceName?: string;
}

export class RemoveDeviceTokenDto {
  userId: string;
  token: string;
}
