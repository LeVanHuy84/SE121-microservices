import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateMusicFeatureDTO } from './create-music-feature.dto';

export class UpdateMusicFeatureDTO extends PartialType(
  OmitType(CreateMusicFeatureDTO, ['audio'] as const),
) {}
