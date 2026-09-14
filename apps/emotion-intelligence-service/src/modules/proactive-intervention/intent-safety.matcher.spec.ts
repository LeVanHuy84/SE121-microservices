import { describe, expect, it } from '@jest/globals';
import { IntentSafetyMatcher } from './intent-safety.matcher';

describe('IntentSafetyMatcher', () => {
  const matcher = new IntentSafetyMatcher();

  describe('matchesEmergencyIntent', () => {
    it('should return false for null, undefined, empty or whitespace strings', () => {
      expect(matcher.matchesEmergencyIntent('')).toBe(false);
      expect(matcher.matchesEmergencyIntent('   ')).toBe(false);
      expect(matcher.matchesEmergencyIntent(null as any)).toBe(false);
      expect(matcher.matchesEmergencyIntent(undefined as any)).toBe(false);
    });

    it('should return false for normal non-crisis messages', () => {
      expect(matcher.matchesEmergencyIntent('Hôm nay tôi thấy hơi mệt mỏi công việc.')).toBe(false);
      expect(matcher.matchesEmergencyIntent('Tôi muốn ăn pizza tối nay.')).toBe(false);
      expect(matcher.matchesEmergencyIntent('Bài hát này nghe hay quá.')).toBe(false);
      expect(matcher.matchesEmergencyIntent('I am feeling a bit stressed about exams.')).toBe(false);
    });

    it('should return true for explicit Vietnamese suicidal & self-harm intents', () => {
      expect(matcher.matchesEmergencyIntent('Tôi muốn tự tử quá')).toBe(true);
      expect(matcher.matchesEmergencyIntent('Tôi định tự sát')).toBe(true);
      expect(matcher.matchesEmergencyIntent('Mình chỉ muốn chết đi cho xong')).toBe(true);
      expect(matcher.matchesEmergencyIntent('Tôi định rạch tay')).toBe(true);
      expect(matcher.matchesEmergencyIntent('Chuẩn bị uống thuốc ngủ quá liều')).toBe(true);
      expect(matcher.matchesEmergencyIntent('Ra nhảy cầu giải thoát')).toBe(true);
      expect(matcher.matchesEmergencyIntent('Đang định treo cổ')).toBe(true);
      expect(matcher.matchesEmergencyIntent('Bế tắc tột cùng không còn lý do để sống')).toBe(true);
      expect(matcher.matchesEmergencyIntent('Tạm biệt thế giới')).toBe(true);
    });

    it('should return true for obfuscated / leetspeak / teen-code variations', () => {
      expect(matcher.matchesEmergencyIntent('t.ự t.ử')).toBe(true);
      expect(matcher.matchesEmergencyIntent('7ự 5á7')).toBe(true);
      expect(matcher.matchesEmergencyIntent('tu sat')).toBe(true);
      expect(matcher.matchesEmergencyIntent('tu tu')).toBe(true);
      expect(matcher.matchesEmergencyIntent('muon ch3t')).toBe(true);
      expect(matcher.matchesEmergencyIntent('ch3t')).toBe(true);
      expect(matcher.matchesEmergencyIntent('ch37')).toBe(true);
      expect(matcher.matchesEmergencyIntent('ch3tt')).toBe(true);
    });

    it('should return true for English crisis slang and phrases', () => {
      expect(matcher.matchesEmergencyIntent('i just want to kms')).toBe(true);
      expect(matcher.matchesEmergencyIntent('i will unalive myself')).toBe(true);
      expect(matcher.matchesEmergencyIntent('want to end my life right now')).toBe(true);
      expect(matcher.matchesEmergencyIntent('thinking about suicide')).toBe(true);
      expect(matcher.matchesEmergencyIntent('i want to die')).toBe(true);
      expect(matcher.matchesEmergencyIntent('time to reset game')).toBe(true);
    });
  });

  describe('evaluateEmergencySafety', () => {
    it('should delegate to matchesEmergencyIntent', () => {
      expect(matcher.evaluateEmergencySafety('Tôi muốn tự tử')).toBe(true);
      expect(matcher.evaluateEmergencySafety('Chào buổi sáng')).toBe(false);
    });
  });
});
