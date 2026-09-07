import { RiskLevel } from '@repo/dtos';
import { AiContext } from './ai.types';

function toRiskInstruction(riskLevel: RiskLevel): string {
  if (
    riskLevel === RiskLevel.CRISIS ||
    riskLevel === RiskLevel.HIGH_RISK
  ) {
    return 'Người dùng đang có dấu hiệu cảm xúc tiêu cực cao. Hãy nhẹ nhàng khuyến khích họ tạm dừng, hít thở và chia sẻ với người họ tin tưởng.';
  }

  if (
    riskLevel === RiskLevel.MODERATE_RISK ||
    riskLevel === RiskLevel.MILD_STRESS
  ) {
    return 'Người dùng đang có dấu hiệu căng thẳng. Hãy gợi ý họ nghỉ ngơi hoặc làm điều gì đó giúp thư giãn.';
  }

  return 'Người dùng đang ổn định. Hãy đưa ra lời động viên nhẹ nhàng và tích cực.';
}

function toTrendHint(trend: AiContext['trend']): string {
  if (trend === 'increasing') {
    return 'Cảm xúc gần đây có xu hướng tiêu cực hơn.';
  }

  if (trend === 'decreasing') {
    return 'Tình hình cảm xúc đang dần cải thiện.';
  }

  return 'Cảm xúc đang tương đối ổn định.';
}

export function buildSystemPrompt(): string {
  return [
    'Bạn là Sentimeta, một trợ lý AI hỗ trợ cảm xúc.',
    'Nhiệm vụ của bạn là tạo ra một lời nhắn ngắn gọn, ấm áp và đồng cảm cho người dùng.',
    '',
    'YÊU CẦU:',
    '- Chỉ trả lời bằng tiếng Việt tự nhiên, thân thiện.',
    '- Giọng văn giống một người bạn quan tâm, không phải bác sĩ.',
    '- Không dùng thuật ngữ kỹ thuật hoặc phân tích dài dòng.',
    '- Không chẩn đoán bất kỳ vấn đề tâm lý nào.',
    '- Không nhắc đến tự tử, tự hại hoặc nội dung tiêu cực nguy hiểm.',
    '',
    'ĐỊNH DẠNG:',
    '- Độ dài tối đa 2–3 câu.',
    '- Phù hợp để hiển thị trong notification.',
    '- Ngắn gọn, dễ đọc, tự nhiên (có thể hơi Gen Z nhưng vẫn lịch sự).',
    '',
    'Chỉ trả về nội dung lời nhắn, không giải thích.',
  ].join('\n');
}

export function buildUserPrompt(context: AiContext): string {
  const instruction = toRiskInstruction(context.riskLevel);
  const trendHint = toTrendHint(context.trend);

  return [
    'Thông tin cảm xúc của người dùng:',
    `- Mức độ rủi ro: ${context.riskLevel}`,
    `- Điểm rủi ro: ${context.riskScore.toFixed(2)}`,
    `- Tỷ lệ cảm xúc tiêu cực: ${context.negativeRatio.toFixed(2)}`,
    `- Xu hướng: ${context.trend}`,
    '',
    trendHint,
    instruction,
    '',
    'Hãy viết một lời nhắn ngắn gọn, phù hợp để gửi ngay cho người dùng.',
  ].join('\n');
}
