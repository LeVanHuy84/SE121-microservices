import {
  CallHandler,
  ExecutionContext,
  GatewayTimeoutException,
} from "@nestjs/common";
import { of, throwError } from "rxjs";
import { delay } from "rxjs/operators";
import { RpcTimeoutInterceptor } from "./rpc-timeout.interceptor";

describe("RpcTimeoutInterceptor", () => {
  const originalDefault = process.env.GATEWAY_RPC_TIMEOUT_MS;

  afterEach(() => {
    process.env.GATEWAY_RPC_TIMEOUT_MS = originalDefault;
  });

  function createHttpContext(url: string): ExecutionContext {
    return {
      getType: () => "http",
      switchToHttp: () => ({
        getRequest: () => ({ url }),
      }),
    } as unknown as ExecutionContext;
  }

  it("passes through fast responses normally", (done) => {
    process.env.GATEWAY_RPC_TIMEOUT_MS = "200";
    const interceptor = new RpcTimeoutInterceptor();
    const next: CallHandler = { handle: () => of({ ok: true }) };

    interceptor.intercept(createHttpContext("/api/v1/posts"), next).subscribe({
      next: (val) => {
        expect(val).toEqual({ ok: true });
        done();
      },
      error: (err) => done.fail(err),
    });
  });

  it("throws GatewayTimeoutException when upstream exceeds timeout", (done) => {
    process.env.GATEWAY_RPC_TIMEOUT_MS = "50";
    const interceptor = new RpcTimeoutInterceptor();
    const next: CallHandler = {
      handle: () => of({ ok: true }).pipe(delay(150)),
    };

    interceptor.intercept(createHttpContext("/api/v1/posts"), next).subscribe({
      next: () => done.fail("Expected timeout error"),
      error: (err) => {
        expect(err).toBeInstanceOf(GatewayTimeoutException);
        done();
      },
    });
  });

  it("propagates non-timeout errors unchanged", (done) => {
    process.env.GATEWAY_RPC_TIMEOUT_MS = "500";
    const interceptor = new RpcTimeoutInterceptor();
    const next: CallHandler = {
      handle: () => throwError(() => new Error("bad request")),
    };

    interceptor.intercept(createHttpContext("/api/v1/posts"), next).subscribe({
      next: () => done.fail("Expected error"),
      error: (err) => {
        expect(err.message).toBe("bad request");
        done();
      },
    });
  });
});
