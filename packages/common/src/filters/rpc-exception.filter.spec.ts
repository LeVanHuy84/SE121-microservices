import { ExceptionsFilter } from './rpc-exception.filter';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

describe('ExceptionsFilter (Suite 4)', () => {
  let filter: ExceptionsFilter;

  beforeEach(() => {
    filter = new ExceptionsFilter();
  });

  it('TC-COM-12: should rethrow existing RpcException intact', async () => {
    const originalException = new RpcException('Custom RPC Error');
    const observable = filter.catch(originalException);

    await expect(firstValueFrom(observable)).rejects.toBe(originalException);
  });

  it('TC-COM-13: should wrap standard Error into RpcException with statusCode 500 and message', async () => {
    const standardError = new Error('Database connection lost');
    const observable = filter.catch(standardError);

    try {
      await firstValueFrom(observable);
      fail('Expected observable to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      const errorResponse = err.getError();
      expect(errorResponse).toEqual({
        statusCode: 500,
        message: 'Database connection lost',
      });
    }
  });

  it('TC-COM-14: should wrap unknown non-Error string or object into generic 500 RpcException', async () => {
    const unknownError = 'Fatal string error';
    const observable = filter.catch(unknownError);

    try {
      await firstValueFrom(observable);
      fail('Expected observable to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      const errorResponse = err.getError();
      expect(errorResponse).toEqual({
        statusCode: 500,
        message: 'Internal server error',
      });
    }
  });

  it('should wrap unknown object (non Error) into generic 500 RpcException', async () => {
    const randomObj = { code: 999 };
    const observable = filter.catch(randomObj);

    try {
      await firstValueFrom(observable);
      fail('Expected observable to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      const errorResponse = err.getError();
      expect(errorResponse).toEqual({
        statusCode: 500,
        message: 'Internal server error',
      });
    }
  });
});

