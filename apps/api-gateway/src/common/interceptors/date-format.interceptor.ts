import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { map } from 'rxjs/operators';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class DateFormatInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((data) =>
        JSON.parse(
          JSON.stringify(data, (key, value) => {
            if (key === 'nextCursor') return value;

            // ✅ Nếu là Date object
            if (value instanceof Date) {
              return dayjs
                .utc(value)
                .tz('Asia/Ho_Chi_Minh')
                .format('YYYY/MM/DD HH:mm:ss');
            }

            // ✅ Nếu là ISO string (có Z -> UTC)
            if (
              typeof value === 'string' &&
              /^\d{4}-\d{2}-\d{2}T/.test(value)
            ) {
              return dayjs
                .utc(value) // ép hiểu là UTC
                .tz('Asia/Ho_Chi_Minh') // convert sang giờ VN
                .format('YYYY/MM/DD HH:mm:ss');
            }

            return value;
          })
        )
      )
    );
  }
}
