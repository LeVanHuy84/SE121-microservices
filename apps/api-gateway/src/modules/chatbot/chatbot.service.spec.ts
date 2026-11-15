import { Readable } from "stream";
import { firstValueFrom, of, throwError, toArray } from "rxjs";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import Redis from "ioredis";
import { AssistantContextService } from "./assistant-context.service";
import { ChatbotService } from "./chatbot.service";

describe("ChatbotService", () => {
  let service: ChatbotService;
  let httpPost: jest.Mock;
  let buildContexts: jest.Mock;
  let userSend: jest.Mock;
  let redisGet: jest.Mock;
  let redisSet: jest.Mock;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === "AI_CHATBOT_SERVICE_URL") return "http://localhost:4006";
        if (key === "AI_CHATBOT_INTERNAL_KEY") return "internal-secret";
        return defaultValue;
      }),
    } as unknown as ConfigService;

    httpPost = jest.fn();
    const httpService = {
      post: httpPost,
      get: jest.fn(),
      delete: jest.fn(),
    } as unknown as HttpService;

    buildContexts = jest
      .fn()
      .mockResolvedValue([
        { type: "post", id: "p1", content: "Personal context" },
      ]);
    const contextService = {
      buildContexts,
    } as unknown as AssistantContextService;

    userSend = jest.fn();
    const userClient = {
      send: userSend,
    } as unknown as ClientProxy;

    redisGet = jest.fn();
    redisSet = jest.fn().mockResolvedValue("OK");
    const redis = {
      get: redisGet,
      set: redisSet,
      del: jest.fn().mockResolvedValue(1),
    } as unknown as Redis;

    service = new ChatbotService(
      configService,
      httpService,
      contextService,
      userClient,
      redis,
    );
  });

  describe("resolveUserAiPolicy", () => {
    it("returns cached policy on Redis hit without calling user-social-service", async () => {
      redisGet.mockResolvedValue("FULL");

      const policy = await service.resolveUserAiPolicy("user-1");

      expect(policy).toBe("FULL");
      expect(redisGet).toHaveBeenCalledWith("user:ai_policy:user-1");
      expect(userSend).not.toHaveBeenCalled();
    });

    it("fetches from user-social-service on cache miss and caches for 300s", async () => {
      redisGet.mockResolvedValue(null);
      userSend.mockReturnValue(of({ privacySettings: { aiPolicy: "FULL" } }));

      const policy = await service.resolveUserAiPolicy("user-2");

      expect(policy).toBe("FULL");
      expect(userSend).toHaveBeenCalledWith("findOneUser", {
        userId: "user-2",
        targetId: "user-2",
      });
      expect(redisSet).toHaveBeenCalledWith(
        "user:ai_policy:user-2",
        "FULL",
        "EX",
        300,
      );
    });

    it("fails closed to RESTRICTED on RPC error", async () => {
      redisGet.mockResolvedValue(null);
      userSend.mockReturnValue(throwError(() => new Error("RPC timeout")));

      const policy = await service.resolveUserAiPolicy("user-3");

      expect(policy).toBe("RESTRICTED");
    });

    it("fails closed to RESTRICTED on Redis error", async () => {
      redisGet.mockRejectedValue(new Error("Redis down"));

      const policy = await service.resolveUserAiPolicy("user-4");

      expect(policy).toBe("RESTRICTED");
      expect(userSend).not.toHaveBeenCalled();
    });

    it("opens circuit breaker only after 3 consecutive failures", async () => {
      redisGet.mockResolvedValue(null);
      userSend.mockReturnValue(throwError(() => new Error("RPC timeout")));

      await expect(service.resolveUserAiPolicy("u-cb-1")).resolves.toBe(
        "RESTRICTED",
      );
      await expect(service.resolveUserAiPolicy("u-cb-2")).resolves.toBe(
        "RESTRICTED",
      );
      expect(userSend).toHaveBeenCalledTimes(2);

      // 3rd failure trips the circuit breaker
      await expect(service.resolveUserAiPolicy("u-cb-3")).resolves.toBe(
        "RESTRICTED",
      );
      expect(userSend).toHaveBeenCalledTimes(3);

      // 4th call short-circuits without hitting Redis or RPC
      await expect(service.resolveUserAiPolicy("u-cb-4")).resolves.toBe(
        "RESTRICTED",
      );
      expect(userSend).toHaveBeenCalledTimes(3);
    });
  });

  describe("respond", () => {
    it("skips resolveContextsWithinBudget and passes contexts=[] when RESTRICTED", async () => {
      redisGet.mockResolvedValue("RESTRICTED");
      httpPost.mockReturnValue(
        of({ data: { success: true, data: { reply: "ok" } } }),
      );

      await service.respond("user-5", {
        message: "hello",
        aiPolicy: "FULL",
      });

      expect(buildContexts).not.toHaveBeenCalled();
      expect(httpPost).toHaveBeenCalledWith(
        "http://localhost:4006/assistant/respond",
        expect.objectContaining({
          userId: "user-5",
          contexts: [],
          aiPolicy: "RESTRICTED",
        }),
        expect.any(Object),
      );
    });

    it("fetches contexts when policy resolves to FULL", async () => {
      redisGet.mockResolvedValue("FULL");
      httpPost.mockReturnValue(
        of({ data: { success: true, data: { reply: "ok" } } }),
      );

      await service.respond("user-6", {
        message: "hello",
      });

      expect(buildContexts).toHaveBeenCalledWith("user-6", "hello");
      expect(httpPost).toHaveBeenCalledWith(
        "http://localhost:4006/assistant/respond",
        expect.objectContaining({
          userId: "user-6",
          contexts: [{ type: "post", id: "p1", content: "Personal context" }],
          aiPolicy: "FULL",
        }),
        expect.any(Object),
      );
    });
  });

  describe("respondStream", () => {
    it("skips buildContexts and forces RESTRICTED when policy is RESTRICTED", async () => {
      redisGet.mockResolvedValue("RESTRICTED");
      httpPost.mockReturnValue(
        of({
          data: Readable.from(['data: {"reply":"ok"}\n\n']),
        }),
      );

      const events = await firstValueFrom(
        service
          .respondStream("user-stream-1", {
            message: "hello stream",
            aiPolicy: "FULL",
          })
          .pipe(toArray()),
      );

      expect(buildContexts).not.toHaveBeenCalled();
      expect(httpPost).toHaveBeenCalledWith(
        "http://localhost:4006/assistant/respond-stream",
        expect.objectContaining({
          userId: "user-stream-1",
          contexts: [],
          aiPolicy: "RESTRICTED",
        }),
        expect.objectContaining({ responseType: "stream" }),
      );
      expect(events).toEqual([{ data: { reply: "ok" } }]);
    });

    it("fetches contexts and forwards FULL when policy resolves to FULL", async () => {
      redisGet.mockResolvedValue("FULL");
      httpPost.mockReturnValue(
        of({
          data: Readable.from(['data: {"reply":"full"}\n\n']),
        }),
      );

      const events = await firstValueFrom(
        service
          .respondStream("user-stream-2", {
            message: "hello full stream",
          })
          .pipe(toArray()),
      );

      expect(buildContexts).toHaveBeenCalledWith(
        "user-stream-2",
        "hello full stream",
      );
      expect(httpPost).toHaveBeenCalledWith(
        "http://localhost:4006/assistant/respond-stream",
        expect.objectContaining({
          userId: "user-stream-2",
          contexts: [{ type: "post", id: "p1", content: "Personal context" }],
          aiPolicy: "FULL",
        }),
        expect.objectContaining({ responseType: "stream" }),
      );
      expect(events).toEqual([{ data: { reply: "full" } }]);
    });
  });

  describe("executeAction", () => {
    it("forwards proposalToken, conversationId, and fail-closed effectivePolicy", async () => {
      redisGet.mockResolvedValue("FULL");
      httpPost.mockReturnValue(of({ data: { success: true } }));

      await service.executeAction("user-7", "Bearer tok", {
        actionId: "act-1",
        actionName: "create_post",
        params: { content: "hi" },
        idempotencyKey: "idem-1",
        proposalToken: "1999999999.abcdef",
        conversationId: "conv-1",
        aiPolicy: "RESTRICTED",
      });

      expect(httpPost).toHaveBeenCalledWith(
        "http://localhost:4006/assistant/actions/execute",
        {
          actionId: "act-1",
          actionName: "create_post",
          params: { content: "hi" },
          idempotencyKey: "idem-1",
          proposalToken: "1999999999.abcdef",
          conversationId: "conv-1",
          userId: "user-7",
          aiPolicy: "FULL",
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer tok",
            "x-user-id": "user-7",
            "x-internal-key": "internal-secret",
          }),
        }),
      );
    });
  });
});
