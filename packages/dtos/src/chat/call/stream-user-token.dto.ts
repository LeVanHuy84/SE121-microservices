import { Expose } from 'class-transformer';

export class StreamUserTokenResponseDTO {
  @Expose()
  token: string;
}
