import {
    Catch,
    ArgumentsHost,
    ExceptionFilter,
    HttpException,
} from '@nestjs/common';

@Catch()
export class GatewayExceptionsFilter implements ExceptionFilter {
    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();

        // Nếu là HttpException (bao gồm lỗi validate DTO)
        if (exception instanceof HttpException) {
            const res = exception.getResponse();
            const status = exception.getStatus();

            return response.status(status).json(
                typeof res === 'string'
                    ? { statusCode: status, message: res }
                    : res
            );
        }

        // Nếu là lỗi từ microservice trả về có statusCode
        if (exception?.statusCode) {
            return response.status(exception.statusCode).json({
                statusCode: exception.statusCode,
                message: exception.message,
            });
        }

        // Các lỗi khác
        const status = 500;
        const message = exception?.message || 'Internal server error';
        response.status(status).json({ statusCode: status, message });
    }
}
