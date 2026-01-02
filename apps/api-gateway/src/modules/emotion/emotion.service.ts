import { Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AnalysisHistoryDTO,
  DashboardQueryDTO,
  EmotionAnalysisDto,
  EmotionByHourDTO,
  EmotionDailyTrendDTO,
} from '@repo/dtos';
import axios from 'axios';

@Injectable()
export class EmotionService {
  private readonly baseUrl: string;
  private readonly internalKey: string;

  constructor(private readonly configService: ConfigService) {
    const baseUrl = this.configService.get<string>('ANALYSIS_SERVICE_URL', {
      infer: true,
    });
    const internalKey = this.configService.get<string>(
      'ANALYSIS_INTERNAL_KEY',
      {
        infer: true,
      }
    );

    if (!baseUrl || !internalKey) {
      throw new Error('Missing ANALYSIS_SERVICE_URL or ANALYSIS_INTERNAL_KEY');
    }

    this.baseUrl = baseUrl;
    this.internalKey = internalKey;
  }

  private headers() {
    return {
      'x-internal-key': this.internalKey,
    };
  }

  async getEmotionDashboard(filter: DashboardQueryDTO) {
    try {
      const from =
        filter.from instanceof Date
          ? filter.from.toISOString().slice(0, 10)
          : filter.from;

      const to =
        filter.to instanceof Date
          ? filter.to.toISOString().slice(0, 10)
          : filter.to;

      const res = await axios.get(`${this.baseUrl}/emotion/dashboard`, {
        headers: this.headers(),
        params: { from, to },
      });

      return res.data;
    } catch (e) {
      throw new HttpException(
        e.response?.data || 'Emotion service error',
        e.response?.status || 500
      );
    }
  }

  async getDetail(id: string): Promise<EmotionAnalysisDto> {
    try {
      const res = await axios.get(`${this.baseUrl}/emotion/detail/${id}`, {
        headers: this.headers(),
      });
      const data = res.data;
      return {
        userId: data.userId,
        targetId: data.targetId,
        targetType: data.targetType,
        textEmotion: {
          dominantEmotion: data.textEmotion.dominantEmotion,
          emotionScores: data.textEmotion.emotionScores,
        },
        imageEmotions: data.imageEmotions.map((img) => ({
          url: img.url,
          faceCount: img.faceCount,
          dominantEmotion: img.dominantEmotion,
          emotionScores: img.emotionScores,
          error: img.error,
        })),
        finalEmotion: data.finalEmotion,
        finalScores: data.finalScores,
        status: data.status,
        errorReason: data.errorReason,
        createdAt: new Date(data.createdAt),
      };
    } catch (e) {
      throw new HttpException(
        e.response?.data || 'Emotion service error',
        e.response?.status || 500
      );
    }
  }

  async getHistory(params: {
    userId: string;
    preset: string;
    fromDate?: string;
    toDate?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    data: AnalysisHistoryDTO[];
    meta: { limit: number; nextCursor: string | null; hasNextPage: boolean };
  }> {
    try {
      const res = await axios.get(`${this.baseUrl}/emotion/history`, {
        params,
        headers: this.headers(),
      });
      return res.data;
    } catch (e) {
      throw new HttpException(
        e.response?.data || 'Emotion service error',
        e.response?.status || 500
      );
    }
  }

  async getSummary(params: {
    userId: string;
    preset: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{
    topEmotion: string;
    count: number;
    distribution: Record<string, number>;
  }> {
    const res = await axios.get(`${this.baseUrl}/emotion/summary`, {
      params,
      headers: this.headers(),
    });
    return res.data;
  }

  async getDailyTrend(params: {
    userId: string;
    preset?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<EmotionDailyTrendDTO[]> {
    const res = await axios.get(`${this.baseUrl}/emotion/summary/daily-trend`, {
      params,
      headers: this.headers(),
    });
    return res.data;
  }

  async getByHour(userId: string): Promise<EmotionByHourDTO[]> {
    const res = await axios.get(`${this.baseUrl}/emotion/summary/by-hour`, {
      params: { userId },
      headers: this.headers(),
    });

    return res.data;
  }
}
