import { MediaItemDTO } from '../../common';
import { AudioDTO } from '../requests';

export class MusicFeatureResponse {
  id: string;
  audio: AudioDTO;
  coverImage: MediaItemDTO;
  artist?: string;
  title: string;
  genre?: string;
  valence: number;
  arousal: number;
  tempo: number;
  rms: number;
  spectralCentroid: number;
  zcr: number;
  createdAt: Date;
}
