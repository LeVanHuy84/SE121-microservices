import { Injectable } from '@nestjs/common';
import { AnalysisResultEventPayload } from '@repo/dtos';

@Injectable()
export class IntentSafetyMatcher {
  // Regex các cụm từ đe dọa tính mạng / tự sát khẩn cấp (Tiếng Việt có dấu, không dấu, lách luật/teen-code & Tiếng Anh)
  private readonly crisisPatterns: RegExp[] = [
    // 1. Tự sát / Tự tử (Có dấu, không dấu, lách luật: t.ự t.ử, 7ự 5á7, tu sat, tu tu)
    /[7t][ựu._-]*\s*[s57áaàảãạâấầẩẫậăắằẳẵặ]*[áaàảãạt]/i,
    /[7t][ựu._-]*\s*[t7ửuửừửữự]/i,
    /t[ứu._-]*sát/i,
    /t[ứu._-]*tử/i,

    // 2. Chết / Ch3t / Ch37 / Muốn chết / Muon chet
    /muốn\s*chết/i,
    /muon\s*chet/i,
    /muon\s*ch3t/i,
    /\bch[3e37t]+t\b/i,
    /\bch3t\b/i,
    /\bch37\b/i,

    // 3. Kết thúc / Giải thoát / Biến mất
    /kết\s*thúc\s*(cuộc\s*đời|mọi\s*thứ|tất\s*cả)/i,
    /ket\s*thuc\s*(cuoc\s*doi|moi\s*thu|tat\s*ca)/i,
    /giải\s*thoát/i,
    /giai\s*thoat/i,
    /biến\s*mất\s*khỏi\s*(thế\s*giới|trái\s*đất|cuộc\s*đời)/i,
    /bien\s*mat\s*khoi\s*(the\s*gioi|trai\s*dat)/i,

    // 4. Không muốn sống / Bế tắc / Không còn lý do
    /không\s*(muốn|còn)\s*sống/i,
    /khong\s*(muon|con)\s*song/i,
    /ko\s*(muon|con)\s*song/i,
    /k\s*muon\s*song/i,
    /không\s*còn\s*lý\s*do\s*(để\s*)?sống/i,
    /bế\s*tắc\s*tột\s*cùng/i,
    /be\s*tac\s*tot\s*cung/i,

    // 5. Hành vi tự hại khẩn cấp (Rạch tay, Uống thuốc, Nhảy cầu/lầu, Treo cổ)
    /rạch\s*(tay|chân|cổ\s*tay)/i,
    /rach\s*(tay|chan|co\s*tay)/i,
    /uống\s*thuốc\s*(ngủ|độc|trừ\s*sâu|quá\s*liều)/i,
    /uong\s*thuoc\s*(ngu|doc|tru\s*sau|qua\s*lieu)/i,
    /nhảy\s*(cầu|lầu|tầng|sông|suối)/i,
    /nhay\s*(cau|lau|tang|song)/i,
    /gieo\s*mình/i,
    /gieo\s*minh/i,
    /treo\s*cổ/i,
    /treo\s*co/i,
    /cắt\s*cổ\s*tay/i,
    /cat\s*co\s*tay/i,
    /kết\s*liễu/i,
    /ket\s*lieu/i,

    // 6. Lời tạm biệt / Trút hơi thở
    /tạm\s*biệt\s*(thế\s*giới|mọi\s*người|cuộc\s*sống)/i,
    /tam\s*biet\s*(the\s*gioi|moi\s*nguoi)/i,
    /trút\s*hơi\s*thở/i,
    /trut\s*hoi\s*tho/i,
    /buông\s*xuôi/i,
    /buong\s*xuoi/i,

    // 7. Từ ngữ tiếng Anh & Slang (KMS, unalive, end my life, suicide)
    /\bkms\b/i,
    /\bunalive\b/i,
    /end\s*my\s*life/i,
    /suicide/i,
    /want\s*to\s*die/i,
    /\breset\s*game\b/i,
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
