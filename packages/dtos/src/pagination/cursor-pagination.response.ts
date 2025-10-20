export class CursorPageResponse<T> {
  constructor(
    public data: T[],
    public limit: number,
    public nextCursor: string | null,
    public hasNextPage: boolean
  ) {}
}
