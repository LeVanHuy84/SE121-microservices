import { Test, TestingModule } from "@nestjs/testing";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
import { ChatPushService } from "./chat-push.service";

describe("NotificationController", () => {
  let controller: NotificationController;

  beforeEach(async () => {
    const mockNotificationService = {};
    const mockChatPushService = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: ChatPushService,
          useValue: mockChatPushService,
        },
      ],
    }).compile();

    controller = module.get<NotificationController>(NotificationController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
