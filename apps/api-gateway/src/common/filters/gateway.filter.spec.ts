import { ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { GatewayExceptionsFilter } from "./gateway.filter";

describe("GatewayExceptionsFilter (RPC to HTTP Error Normalization)", () => {
  let filter: GatewayExceptionsFilter;
  let mockResponse: any;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new GatewayExceptionsFilter();
    mockResponse = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ url: "/api/test" }),
      }),
    } as unknown as ArgumentsHost;
  });

  it("TC-GW-08: converts downstream microservice RPC 404 error to HTTP 404", () => {
    const rpcError = {
      error: {
        statusCode: 404,
        message: "User not found",
      },
    };

    filter.catch(rpcError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: 404,
      message: "User not found",
    });
  });

  it("TC-GW-09: converts downstream microservice RPC 403 error to HTTP 403", () => {
    const rpcError = {
      error: {
        statusCode: 403,
        message: "Forbidden conversation access",
      },
    };

    filter.catch(rpcError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: 403,
      message: "Forbidden conversation access",
    });
  });

  it("TC-GW-10: handles downstream microservice crash, timeout or unhandled error with HTTP 500", () => {
    const unhandledError = new Error(
      "Downstream service timed out after 5000ms",
    );

    filter.catch(unhandledError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: "Downstream service timed out after 5000ms",
    });
  });

  it("handles standard HttpException with structured response", () => {
    const httpException = new HttpException(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: ["name must be a string"],
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(httpException, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: ["name must be a string"],
    });
  });

  it("handles standard HttpException with string response", () => {
    const httpException = new HttpException(
      "Bad Request Message",
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(httpException, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: "Bad Request Message",
    });
  });

  it("does not write to response if headersSent is true", () => {
    mockResponse.headersSent = true;

    filter.catch(new Error("Late error"), mockHost);

    expect(mockResponse.status).not.toHaveBeenCalled();
    expect(mockResponse.json).not.toHaveBeenCalled();
  });
});
