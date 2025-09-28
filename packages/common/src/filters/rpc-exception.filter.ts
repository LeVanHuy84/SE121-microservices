import { Catch, RpcExceptionFilter, ArgumentsHost } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';

@Catch()
export class ExceptionsFilter implements RpcExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): Observable<any> {
    console.error('Exception caught by filter:', exception);

    if (exception instanceof RpcException) {
      return throwError(() => exception.getError());
    }

    if (exception instanceof Error) {
      return throwError(() => ({
        statusCode: 500,
        message: exception.message,
      }));
    }

    return throwError(() => ({
      statusCode: 500,
      message: 'Internal server error',
    }));
  }
}
