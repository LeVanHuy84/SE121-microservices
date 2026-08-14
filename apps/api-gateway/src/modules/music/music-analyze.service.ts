import { Injectable, HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

@Injectable()
export class MusicAnalyzeService {
  private readonly baseUrl: string;
  private readonly internalKey: string;

  constructor(private readonly configService: ConfigService) {
    const baseUrl =
      this.configService.get<string>("AI_CHATBOT_SERVICE_URL", {
        infer: true,
      }) ||
      this.configService.get<string>("CHATBOT_SERVICE_URL", { infer: true }) ||
      this.configService.get<string>("ANALYSIS_SERVICE_URL", { infer: true }) ||
      "http://localhost:4015";

    const internalKey =
      this.configService.get<string>("AI_CHATBOT_INTERNAL_KEY", {
        infer: true,
      }) ||
      this.configService.get<string>("CHATBOT_INTERNAL_KEY", { infer: true }) ||
      this.configService.get<string>("ANALYSIS_INTERNAL_KEY", { infer: true });

    if (!baseUrl || !internalKey) {
      throw new Error("Missing AI_CHATBOT_SERVICE_URL or internal key");
    }

    this.baseUrl = baseUrl;
    this.internalKey = internalKey;
  }

  private headers() {
    return {
      "x-internal-key": this.internalKey,
    };
  }

  private toHttpException(error: unknown): HttpException {
    if (axios.isAxiosError(error)) {
      return new HttpException(
        error.response?.data || "Emotion service error",
        error.response?.status || 500,
      );
    }

    return new HttpException("Emotion service error", 500);
  }

  async analyzeMusic(url: string) {
    try {
      const res = await axios.post(
        `${this.baseUrl}/musics/analyze`,
        { url },
        { headers: this.headers() },
      );
      return res.data;
    } catch (e: unknown) {
      throw this.toHttpException(e);
    }
  }
}
