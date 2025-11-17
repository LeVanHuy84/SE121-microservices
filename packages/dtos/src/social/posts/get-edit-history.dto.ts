import { Expose } from 'class-transformer';

export class EditHistoryReponseDTO {
  @Expose()
  id: string;

  @Expose()
  oldContent: string;

  @Expose()
  editAt: Date;
}
