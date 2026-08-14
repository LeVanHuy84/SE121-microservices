import { Test, TestingModule } from "@nestjs/testing";
import { NotificationController } from "./notification.controller";

describe("NotificationController", () => {
  let controller: NotificationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        {
          provide: "CONTENT_FEED_SERVICE",
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<NotificationController>(NotificationController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
