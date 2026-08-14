import { Test, TestingModule } from "@nestjs/testing";
import { UserPreferenceService } from "./user-preference.service";
import { getModelToken } from "@nestjs/mongoose";
import { UserPreference } from "../mongo/schema/user-preference.schema";
import { getRedisToken } from "@nestjs-modules/ioredis";

describe("UserPreferenceService", () => {
  let service: UserPreferenceService;

  beforeEach(async () => {
    const mockModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    const mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      multi: jest.fn().mockReturnValue({
        incr: jest.fn().mockReturnThis(),
        decr: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserPreferenceService,
        {
          provide: getModelToken(UserPreference.name),
          useValue: mockModel,
        },
        {
          provide: "default_IORedisModuleConnectionToken",
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<UserPreferenceService>(UserPreferenceService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
