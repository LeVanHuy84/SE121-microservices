/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Neo4jService } from './neo4j.service';
import { from, Observable } from 'rxjs';
import { catchError, finalize, mergeMap } from 'rxjs/operators';

@Injectable()
export class Neo4jTransactionInterceptor implements NestInterceptor {
  constructor(private readonly neo4jService: Neo4jService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const rpcContext = context.switchToRpc();
    const payload = rpcContext.getData(); // chính là payload
    const { session, tx } = this.neo4jService.beginTransactionWithSession();

    // gắn transaction vào payload
    payload.transaction = tx;

    return next.handle().pipe(
      mergeMap((result) => from(tx.commit().then(() => result))),
      catchError((err) =>
        from(
          tx.rollback().then(() => {
            throw err;
          }),
        ),
      ),
      finalize(() => {
        session.close().catch(() => null);
      }),
    );
  }
}
