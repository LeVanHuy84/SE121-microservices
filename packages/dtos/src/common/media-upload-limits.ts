import { MediaType } from './enum';

export const MEDIA_UPLOAD_MAX_BYTES: Record<MediaType, number> = {
  [MediaType.IMAGE]: 5 * 1024 * 1024,
  [MediaType.VIDEO]: 20 * 1024 * 1024,
  [MediaType.AUDIO]: 10 * 1024 * 1024,
  [MediaType.FILE]: 10 * 1024 * 1024,
};
