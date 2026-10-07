import {
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";

@Catch()
export class GatewayExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(GatewayExceptionsFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (response.headersSent) {
      this.logger.error(
        "Error occurred after headers were sent",
        exception?.stack || exception,
      );
      return;
    }

    // Nếu là HttpException (bao gồm lỗi validate DTO)
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const status = exception.getStatus();

      return response
        .status(status)
        .json(
          typeof res === "string" ? { statusCode: status, message: res } : res,
        );
    }

    // Nếu là lỗi từ microservice trả về có statusCode
    if (exception?.error?.statusCode) {
      return response.status(exception.error.statusCode).json({
        statusCode: exception.error.statusCode,
        message: exception.error.message,
      });
    }

    // Các lỗi khác
    const status = 500;
    const message = exception?.message || "Internal server error";
    this.logger.error(
      `[500 Internal Server Error] ${message}`,
      exception?.stack || exception,
    );
    response.status(status).json({ statusCode: status, message });
  }
}
