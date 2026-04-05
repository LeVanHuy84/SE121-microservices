import { MediaDeleteItem, MediaItemDTO, MediaType } from '@repo/dtos';

export type CloudinaryResourceType = 'image' | 'video' | 'raw';

type MediaLike = Pick<MediaItemDTO, 'publicId' | 'url' | 'type' | 'mimeType'>;

export function resolveMediaType(media: Pick<MediaItemDTO, 'type' | 'mimeType'>): MediaType {
  if (media.type) {
    return media.type;
  }

  if (media.mimeType?.startsWith('image/')) {
    return MediaType.IMAGE;
  }

  if (media.mimeType?.startsWith('video/')) {
    return MediaType.VIDEO;
  }

  if (media.mimeType?.startsWith('audio/')) {
    return MediaType.AUDIO;
  }

  return MediaType.FILE;
}

export function toCloudinaryResourceType(type: MediaType): CloudinaryResourceType {
  switch (type) {
    case MediaType.IMAGE:
      return 'image';
    case MediaType.VIDEO:
    case MediaType.AUDIO:
      return 'video';
    case MediaType.FILE:
    default:
      return 'raw';
  }
}

export function toMediaAssignItems(
  medias: Array<MediaLike | undefined | null>,
): { publicId: string; url?: string; type: MediaType }[] {
  return medias
    .filter((media): media is MediaLike & { publicId: string } => !!media?.publicId)
    .map((media) => ({
      publicId: media.publicId,
      url: media.url,
      type: resolveMediaType(media),
    }));
}

export function toMediaDeleteItems(
  medias: Array<MediaLike | undefined | null>,
): MediaDeleteItem[] {
  return medias
    .filter((media): media is MediaLike & { publicId: string } => !!media?.publicId)
    .map((media) => ({
      publicId: media.publicId,
      resourceType: toCloudinaryResourceType(resolveMediaType(media)),
    }));
}
