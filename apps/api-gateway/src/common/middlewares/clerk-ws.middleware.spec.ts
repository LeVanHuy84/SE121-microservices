import { clerkWsMiddleware } from "./clerk-ws.middleware";
import * as clerkBackend from "@clerk/backend";

jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn(),
}));

describe("clerkWsMiddleware (Suite 4: WebSocket Authentication)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLERK_SECRET_KEY = "test-secret";
  });

  it("TC-GW-15: rejects connection when auth token is missing from handshake", async () => {
    const socket: any = {
      handshake: {
        auth: {},
      },
    };
    const next = jest.fn();

    await clerkWsMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toBe("Unauthorized");
    expect(socket.user).toBeUndefined();
  });

  it("TC-GW-16: authenticates socket successfully when valid Clerk token is provided", async () => {
    const socket: any = {
      handshake: {
        auth: { token: "valid-ws-clerk-token" },
      },
    };
    const next = jest.fn();

    (clerkBackend.verifyToken as jest.Mock).mockResolvedValue({
      sub: "user-ws-123",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    await clerkWsMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.user).toEqual({ id: "user-ws-123" });
    expect(socket.data.lastVerifiedAt).toBeDefined();
    expect(socket.data.tokenExp).toBeDefined();
  });

  it("rejects connection when verifyToken throws an error", async () => {
    const socket: any = {
      handshake: {
        auth: { token: "invalid-token" },
      },
    };
    const next = jest.fn();

    (clerkBackend.verifyToken as jest.Mock).mockRejectedValue(
      new Error("JWT expired"),
    );

    await clerkWsMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toBe("Unauthorized");
  });

  it("rejects connection when verifyToken returns session without sub", async () => {
    const socket: any = {
      handshake: {
        auth: { token: "token-no-sub" },
      },
    };
    const next = jest.fn();

    (clerkBackend.verifyToken as jest.Mock).mockResolvedValue({});

    await clerkWsMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toBe("Unauthorized");
  });
});
