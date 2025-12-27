import { Catch, RpcExceptionFilter } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';

@Catch()
export class ExceptionsFilter implements RpcExceptionFilter {
  catch(exception: unknown): Observable<any> {
    if (exception instanceof RpcException) {
      return throwError(() => exception);
    }

    if (exception instanceof Error) {
      return throwError(
        () =>
          new RpcException({
            statusCode: 500,
            message: exception.message,
          })
      );
    }

    return throwError(
      () =>
        new RpcException({
          statusCode: 500,
          message: 'Internal server error',
        })
    );
  }
}
