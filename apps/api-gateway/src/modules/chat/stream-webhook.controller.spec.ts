import { UnauthorizedException } from "@nestjs/common";
import { StreamWebhookController } from "./stream-webhook.controller";
import * as crypto from "crypto";

describe("StreamWebhookController (Suite 3: Stream Video Webhook Verification)", () => {
  let controller: StreamWebhookController;
  let chatClient: any;
  const SECRET = "test-stream-api-secret";

  beforeEach(() => {
    process.env.STREAM_API_SECRET = SECRET;
    chatClient = {
      emit: jest.fn(),
    };
    controller = new StreamWebhookController(chatClient);
  });

  afterEach(() => {
    delete process.env.STREAM_API_SECRET;
  });

  const generateSignature = (payload: string, secret: string) => {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  };

  it("returns { success: false } if STREAM_API_SECRET is not configured", async () => {
    delete process.env.STREAM_API_SECRET;
    const req: any = {
      rawBody: Buffer.from(JSON.stringify({ type: "call.ended" })),
    };

    const result = await controller.handleWebhook(req, "any-sig", {
      type: "call.ended",
    });

    expect(result).toEqual({ success: false });
  });

  it("throws UnauthorizedException when x-signature header is missing", async () => {
    const req: any = { rawBody: Buffer.from("{}") };

    await expect(controller.handleWebhook(req, "", {})).rejects.toThrow(
      new UnauthorizedException("Missing x-signature header"),
    );
  });

  it("throws UnauthorizedException when rawBody is missing", async () => {
    const req: any = {};

    await expect(controller.handleWebhook(req, "sig", {})).rejects.toThrow(
      new UnauthorizedException("Missing raw body"),
    );
  });

  it("TC-GW-12: throws UnauthorizedException when signature does not match payload HMAC", async () => {
    const payload = JSON.stringify({ type: "call.session_ended" });
    const req: any = { rawBody: Buffer.from(payload) };
    const invalidSignature = "invalid_hmac_signature_hex";

    await expect(
      controller.handleWebhook(req, invalidSignature, {
        type: "call.session_ended",
      }),
    ).rejects.toThrow(new UnauthorizedException("Invalid signature"));
  });

  it("TC-GW-11 & TC-GW-13: accepts valid signature and emits handleStreamCallEndedWebhook on call.session_ended", async () => {
    const body = {
      type: "call.session_ended",
      call_cid: "default:call-uuid-123",
    };
    const payload = JSON.stringify(body);
    const validSignature = generateSignature(payload, SECRET);
    const req: any = { rawBody: Buffer.from(payload) };

    const result = await controller.handleWebhook(req, validSignature, body);

    expect(result).toEqual({ success: true });
    expect(chatClient.emit).toHaveBeenCalledWith(
      "handleStreamCallEndedWebhook",
      {
        callId: "call-uuid-123",
      },
    );
  });

  it("TC-GW-14: emits handleStreamCallEndedWebhook on call.participant_left when participants count is 0", async () => {
    const body = {
      type: "call.participant_left",
      call: {
        id: "call-room-999",
        session: {
          participants: [],
        },
      },
    };
    const payload = JSON.stringify(body);
    const validSignature = generateSignature(payload, SECRET);
    const req: any = { rawBody: Buffer.from(payload) };

    const result = await controller.handleWebhook(req, validSignature, body);

    expect(result).toEqual({ success: true });
    expect(chatClient.emit).toHaveBeenCalledWith(
      "handleStreamCallEndedWebhook",
      {
        callId: "call-room-999",
      },
    );
  });

  it("does not emit handleStreamCallEndedWebhook on call.participant_left if members remain", async () => {
    const body = {
      type: "call.participant_left",
      call: {
        id: "call-room-999",
        session: {
          participants: [{ user_id: "user-2" }],
        },
      },
    };
    const payload = JSON.stringify(body);
    const validSignature = generateSignature(payload, SECRET);
    const req: any = { rawBody: Buffer.from(payload) };

    const result = await controller.handleWebhook(req, validSignature, body);

    expect(result).toEqual({ success: true });
    expect(chatClient.emit).not.toHaveBeenCalled();
  });
});
