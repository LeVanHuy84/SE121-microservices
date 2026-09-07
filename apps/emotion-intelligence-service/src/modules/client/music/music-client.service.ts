import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  MusicFeatureResponse,
  MusicSuggestionItemDto,
  PageResponse,
  PaginationDTO,
  RiskLevel,
} from '@repo/dtos';
import { lastValueFrom, timeout, catchError, of } from 'rxjs';

@Injectable()
export class MusicClientService {
  private readonly logger = new Logger(MusicClientService.name);

  constructor(
    @Inject('SEARCH_RECOMMENDATION_SERVICE')
    private readonly client: ClientProxy,
  ) {}

  /**
   * Push-based RPC Call: Truy vấn danh sách nhạc gợi ý bằng cách TRUYỀN THẲNG chỉ số cảm xúc
   * (emotionVector & riskLevel) sang search-recommendation-service (port 4003).
   * Tránh hoàn toàn việc callback ngược về emotion-intelligence-service gây VÒNG LẶP CHỜ (Circular RPC Deadlock).
   */
  async getRelaxingMusicBySignal(
    emotionVector?: Record<string, number>,
    riskLevel?: RiskLevel,
    limit = 5,
  ): Promise<MusicSuggestionItemDto[]> {
    try {
      const payload = {
        emotionVector,
        riskLevel,
        query: { page: 1, limit } as PaginationDTO,
      };

      const response = await lastValueFrom(
        this.client
          .send<PageResponse<MusicFeatureResponse>>(
            'get_music_recommendations_by_signal',
            payload,
          )
          .pipe(
            timeout(3000),
            catchError((err) => {
              this.logger.warn(
                `Failed to fetch music from search-recommendation-service (${err.message}). Using fallback playlists.`,
              );
              return of(null);
            }),
          ),
      );

      if (response && response.data && response.data.length > 0) {
        return response.data.map((item) => ({
          title: item.title,
          artist: item.artist,
          audioUrl: item.audio?.url,
          coverUrl: item.coverImage?.url,
          moodTarget: 'calm',
          genre: item.genre || 'lofi',
        }));
      }
    } catch (error) {
      this.logger.error(
        'Error querying search-recommendation-service via TCP RPC',
        error,
      );
    }

    // Fallback playlist an toàn khi service chưa có dữ liệu bài hát
    return [
      {
        title: 'Lo-Fi Chill & Relax',
        artist: 'Healing Sounds',
        moodTarget: 'calm',
        genre: 'lofi',
      },
      {
        title: 'Nhạc Không Lời Xoa Dịu Tâm Trạng',
        artist: 'Acoustic Peace',
        moodTarget: 'peaceful',
        genre: 'acoustic',
      },
    ];
  }
}
