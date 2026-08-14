import { Test, TestingModule } from "@nestjs/testing";
import { SocialController } from "./social.controller";

describe("SocialController", () => {
  let controller: SocialController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [
        {
          provide: "USER_SOCIAL_SERVICE",
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<SocialController>(SocialController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
