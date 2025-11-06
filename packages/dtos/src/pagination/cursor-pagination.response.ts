export class CursorPageResponse<T> {
  constructor(
    public data: T[],
    public nextCursor: string | null,
    public hasNextPage: boolean
  ) {}
}
