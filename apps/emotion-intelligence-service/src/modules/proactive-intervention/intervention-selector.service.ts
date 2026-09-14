import { Injectable, Logger } from '@nestjs/common';
import { InterventionResourceDocument } from 'src/mongo/schema/intervention-resource.schema';
import { EmergencyHotlineDocument } from 'src/mongo/schema/emergency-hotline.schema';
import { RiskLevel, TriggerFlag, InterventionMediaType } from '@repo/dtos';

export interface SelectionContext {
  userId: string;
  riskLevel: RiskLevel;
  riskScore: number;
  triggers: TriggerFlag[];
  content?: string;
  primaryEmotion?: string;
  emotionVector?: Record<string, number>;
}

interface GroqSelectionResponse {
  selectedResourceId?: string;
  reasoning?: string;
}

@Injectable()
export class InterventionSelectorService {
  private readonly logger = new Logger(InterventionSelectorService.name);

  /**
   * Lựa chọn bài tập can thiệp tối ưu nhất từ danh sách bài tập khả dụng trong Admin DB
   * Ưu tiên dùng Groq AI (với timeout <1200ms), fallback về Rule Matcher nếu lỗi/bận
   */
  async selectBestResource(
    resources: InterventionResourceDocument[],
    context: SelectionContext,
  ): Promise<InterventionResourceDocument | null> {
    if (!resources || resources.length === 0) {
      this.logger.warn(
        `No active intervention resources available for riskLevel=${context.riskLevel}`,
      );
      return null;
    }

    if (resources.length === 1) {
      return resources[0];
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey) {
      try {
        const aiSelected = await this.selectViaGroq(resources, context, apiKey);
        if (aiSelected) {
          this.logger.log(
            `Groq AI selected intervention resource title="${aiSelected.title}" id=${aiSelected._id.toString()} for user=${context.userId}`,
          );
          return aiSelected;
        }
      } catch (err: any) {
        this.logger.warn(
          `Groq AI resource selection failed/timed out: ${err.message}. Falling back to Rule Matcher.`,
        );
      }
    }

    // Fallback: Rule-based Priority & Emotion Matcher
    return this.selectViaRuleMatcher(resources, context);
  }

  /**
   * Phân loại và chia nhóm Hotline thành Primary Hotline (gọi nhanh) và Secondary Hotlines
   * Kiểm tra giờ hoạt động thời gian thực (Real-time Availability Filtering):
   * Ưu tiên Hotline đang mở cửa tại thời điểm hiện tại và trực 24/7.
   */
  dispatchHotlines(hotlines: EmergencyHotlineDocument[], now = new Date()) {
    if (!hotlines || hotlines.length === 0) {
      return { primary: undefined, secondary: [] };
    }

    const sorted = [...hotlines].sort((a, b) => {
      const aOpen = this.isHotlineCurrentlyOpen(a, now);
      const bOpen = this.isHotlineCurrentlyOpen(b, now);

      // 1. Ưu tiên Hotline đang mở cửa tại thời điểm hiện tại
      if (aOpen !== bOpen) {
        return aOpen ? -1 : 1;
      }

      // 2. Ưu tiên Hotline có cờ isPrimary
      if (a.isPrimary !== b.isPrimary) {
        return a.isPrimary ? -1 : 1;
      }

      // 3. Ưu tiên thứ tự hiển thị displayOrder
      return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
    });

    const primary = sorted[0];
    const secondary = sorted.slice(1);

    return { primary, secondary };
  }

  /**
   * Kiểm tra xem Hotline có đang mở cửa tại thời điểm hiện tại hay không
   */
  private isHotlineCurrentlyOpen(
    hotline: EmergencyHotlineDocument,
    now: Date,
  ): boolean {
    // Nếu trực 24/7 -> Luôn luôn mở cửa
    if (hotline.is247 || hotline.operatingHoursConfig?.is247) {
      return true;
    }

    const config = hotline.operatingHoursConfig;
    if (!config) return true; // Fallback nếu không có cấu hình chi tiết

    // Kiểm tra ngày trong tuần (1 = Thứ Hai, 7 = Chủ Nhật)
    const currentDay = now.getDay() === 0 ? 7 : now.getDay();
    if (
      config.daysOfWeek &&
      config.daysOfWeek.length > 0 &&
      !config.daysOfWeek.includes(currentDay)
    ) {
      return false;
    }

    // Kiểm tra khung giờ mở/đóng cửa (Định dạng HH:mm)
    if (config.startTime && config.endTime) {
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const [startH, startM] = config.startTime.split(':').map(Number);
      const [endH, endM] = config.endTime.split(':').map(Number);

      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    return true;
  }

  /**
   * Truy vấn Groq AI Chat Completion để đóng vai chuyên gia lâm sàng chọn bài tập
   */
  private async selectViaGroq(
    resources: InterventionResourceDocument[],
    context: SelectionContext,
    apiKey: string,
  ): Promise<InterventionResourceDocument | null> {
    const model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

    const candidates = resources.map((r) => ({
      id: r._id.toString(),
      title: r.title,
      mediaType: r.mediaType,
      description: r.description,
      sourceOrganization: r.sourceOrganization,
    }));

    const systemPrompt =
      'Bạn là trợ lý Chuyên gia Tâm lý Lâm sàng. Hãy chọn duy nhất 1 ID bài tập hỗ trợ tâm lý phù hợp nhất cho người dùng dựa trên trạng thái cảm xúc và tâm sự của họ. Trả về đúng dạng JSON: {"selectedResourceId": "<ID>", "reasoning": "<lý do ngắn gọn 1 câu>"}';

    const userPrompt = JSON.stringify({
      userContext: {
        riskLevel: context.riskLevel,
        primaryEmotion: context.primaryEmotion,
        triggers: context.triggers,
        userMessage: context.content || 'Người dùng đang gặp áp lực tâm lý.',
      },
      candidateResources: candidates,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2s timeout limit

    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
            max_tokens: 150,
          }),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();
      const rawContent = data.choices?.[0]?.message?.content?.trim();
      if (!rawContent) return null;

      const parsed: GroqSelectionResponse = JSON.parse(rawContent);
      if (parsed?.selectedResourceId) {
        const matched = resources.find(
          (r) => r._id.toString() === parsed.selectedResourceId,
        );
        if (matched) return matched;
      }
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }

    return null;
  }

  /**
   * Rule-Based Score Fallback khi AI không khả dụng (<5ms)
   * Sử dụng chuẩn 7 nhãn cảm xúc PhoBERT (joy, sadness, anger, fear, disgust, surprise, neutral)
   * và vector chỉ số cảm xúc emotionVectorEMA
   */
  private selectViaRuleMatcher(
    resources: InterventionResourceDocument[],
    context: SelectionContext,
  ): InterventionResourceDocument {
    let bestResource = resources[0];
    let maxScore = -1;

    const primary = (context.primaryEmotion || '').toLowerCase();
    const vector = context.emotionVector || {};
    const fearScore = vector['fear'] || (primary === 'fear' ? 0.8 : 0);
    const sadnessScore = vector['sadness'] || (primary === 'sadness' ? 0.8 : 0);
    const angerScore = vector['anger'] || (primary === 'anger' ? 0.8 : 0);

    for (const res of resources) {
      let score = res.priority || 0;

      // 1. Sợ hãi / Lo âu bùng phát (fear) -> Ưu tiên Infographic / PDF y khoa hướng dẫn hít thở
      if (
        fearScore >= 0.5 &&
        (res.mediaType === InterventionMediaType.INFOGRAPHIC ||
          res.mediaType === InterventionMediaType.PDF_DOCUMENT)
      ) {
        score += 5 + fearScore * 3;
      }

      // 2. U buồn / Suy sụp (sadness) -> Ưu tiên Infographic / PDF / Video y khoa
      if (sadnessScore >= 0.5) {
        if (
          res.mediaType === InterventionMediaType.INFOGRAPHIC ||
          res.mediaType === InterventionMediaType.PDF_DOCUMENT
        ) {
          score += 4 + sadnessScore * 3;
        } else if (res.mediaType === InterventionMediaType.VIDEO) {
          score += 3 + sadnessScore * 2;
        }
      }

      // 3. Tức giận / Bức bối (anger) -> Ưu tiên Infographic / Audio xoa dịu
      if (
        angerScore >= 0.5 &&
        (res.mediaType === InterventionMediaType.INFOGRAPHIC ||
          res.mediaType === InterventionMediaType.AUDIO)
      ) {
        score += 4 + angerScore * 2;
      }

      if (score > maxScore) {
        maxScore = score;
        bestResource = res;
      }
    }

    return bestResource;
  }
}
