import { Expose, Type } from 'class-transformer';

export class CursorPaginationResponseDTO<T> {
  @Expose()
  @Type(() => Object)
  data: T[];

  @Expose()
  nextCursor?: string;

  @Expose()
  hasMore: boolean;

  constructor(partial: Partial<CursorPaginationResponseDTO<T>>) {
    Object.assign(this, partial);
  }
}
