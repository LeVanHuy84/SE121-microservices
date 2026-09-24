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
      "http://localhost:4006";

    const internalKey =
      this.configService.get<string>("AI_CHATBOT_INTERNAL_KEY", {
        infer: true,
      }) ||
      this.configService.get<string>("CHATBOT_INTERNAL_KEY", { infer: true }) ||
      this.configService.get<string>("ANALYSIS_INTERNAL_KEY", { infer: true }) ||
      "chatbot-internal-key-123";

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
      const status = error.response?.status || 500;
      const data = error.response?.data;
      const message =
        (typeof data === "object" && data !== null && "detail" in data
          ? data.detail
          : null) ||
        (typeof data === "object" && data !== null && "message" in data
          ? data.message
          : null) ||
        (typeof data === "string" ? data : null) ||
        error.message ||
        "Emotion service error";

      return new HttpException(message, status);
    }

    return new HttpException(
      error instanceof Error ? error.message : "Emotion service error",
      500,
    );
  }

  async analyzeMusic(url: string) {
    if (!url) {
      throw new HttpException("Missing music url", 400);
    }
    try {
      const res = await axios.post(
        `${this.baseUrl}/musics/analyze`,
        { url },
        {
          headers: this.headers(),
          timeout: 60000, // 60s timeout for audio download & AI inference
        },
      );
      return res.data;
    } catch (e: unknown) {
      throw this.toHttpException(e);
    }
  }
}
