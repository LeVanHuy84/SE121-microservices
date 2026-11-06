import { ExecutionContext } from "@nestjs/common";
import { LoadTestThrottlerGuard } from "./load-test-throttler.guard";

describe("LoadTestThrottlerGuard (Rate Limiting resilience)", () => {
  let guard: LoadTestThrottlerGuard;
  const mockOptions: any = {};
  const mockStorageService: any = {};
  const mockReflector: any = {
    getAllAndOverride: jest.fn(),
  };

  beforeEach(() => {
    delete process.env.ENABLE_LOAD_TEST_MODE;
    guard = new LoadTestThrottlerGuard(
      mockOptions,
      mockStorageService,
      mockReflector,
    );
  });

  const mockContext = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, ip: "127.0.0.1" }),
      getResponse: () => ({}),
    }),
    getHandler: () => () => {},
    getClass: () => class {},
  } as unknown as ExecutionContext;

  it("TC-GW-07: skips throttler check entirely when ENABLE_LOAD_TEST_MODE is true", async () => {
    process.env.ENABLE_LOAD_TEST_MODE = "true";

    const shouldSkip = await (guard as any).shouldSkip(mockContext);

    expect(shouldSkip).toBe(true);
  });

  it("delegates to super.shouldSkip when ENABLE_LOAD_TEST_MODE is not true", async () => {
    const superSpy = jest
      .spyOn(
        Object.getPrototypeOf(LoadTestThrottlerGuard.prototype),
        "shouldSkip",
      )
      .mockResolvedValue(false);

    const shouldSkip = await (guard as any).shouldSkip(mockContext);

    expect(shouldSkip).toBe(false);
    expect(superSpy).toHaveBeenCalledWith(mockContext);
  });
});
