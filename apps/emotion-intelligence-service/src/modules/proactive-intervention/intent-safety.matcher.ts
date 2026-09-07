import { Injectable } from '@nestjs/common';
import { AnalysisResultEventPayload } from '@repo/dtos';

@Injectable()
export class IntentSafetyMatcher {
  // Regex các cụm từ đe dọa tính mạng / tự sát khẩn cấp tiếng Việt (Bao gồm lách luật/abbreviations)
  private readonly crisisPatterns: RegExp[] = [
    /tự\s*sát/i,
    /t[ứu\.\_\-]*sát/i,
    /tự\s*tử/i,
    /t[ứu\.\_\-]*tử/i,
    /muốn\s*chết/i,
    /ch3t/i,
    /kết\s*thúc\s*cuộc\s*đời/i,
    /kết\s*thúc\s*mọi\s*thứ/i,
    /không\s*muốn\s*sống\s*nữa/i,
    /rạch\s*tay/i,
    /uống\s*thuốc\s*ngủ/i,
    /nhảy\s*cầu/i,
    /nhảy\s*lầu/i,
    /kết\s*liễu/i,
    /tạm\s*biệt\s*thế\s*giới/i,
    /reset\s*game/i,
    /buông\s*xuôi/i,
    /bế\s*tắc\s*tột\s*cùng/i,
    /không\s*còn\s*lý\s*do\s*để\s*sống/i,
  ];

  /**
   * Kiểm tra xem văn bản có chứa từ khóa tự hại/đe dọa tính mạng trực tiếp hay không
   */
  matchesEmergencyIntent(text: string): boolean {
    if (!text) return false;
    const cleanText = text.trim();
    return this.crisisPatterns.some((pattern) => pattern.test(cleanText));
  }

  /**
   * Emergency Safety Check: Bắt buộc khớp Regex từ khóa tự hại / tự sát khẩn cấp (Deterministic).
   * Không tự động gán CRISIS chỉ dựa trên nhãn AI (tránh AI đoán sai/ảo giác làm nhảy hotline khẩn cấp).
   */
  evaluateEmergencySafety(
    text: string,
    _payload?: Partial<AnalysisResultEventPayload>,
  ): boolean {
    return this.matchesEmergencyIntent(text);
  }
}
