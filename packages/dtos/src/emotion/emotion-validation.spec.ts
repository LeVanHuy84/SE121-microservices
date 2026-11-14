import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateInterventionResourceDto,
  CreateEmergencyHotlineDto,
  TargetRiskLevel,
  InterventionMediaType,
} from './admin-intervention.dto';
import {
  ProactiveInterventionDto,
  SuggestedInterventionAction,
} from './proactive-intervention.dto';
import { RiskLevel, TriggerFlag } from './enums';

describe('Emotion Intelligence DTO Validation & Contracts (TC-DTO-05)', () => {
  describe('CreateInterventionResourceDto', () => {
    it('TC-DTO-05: should pass validation when valid intervention resource is provided', async () => {
      const dto = plainToInstance(CreateInterventionResourceDto, {
        title: 'Mindful Breathing Exercise',
        description: 'A 5-minute guided audio to regulate stress and anxiety.',
        targetRiskLevels: [TargetRiskLevel.MILD_STRESS, TargetRiskLevel.MODERATE_RISK],
        mediaType: InterventionMediaType.AUDIO,
        mediaUrl: 'https://cdn.example.com/audio/mindful-breathing.mp3',
        sourceOrganization: 'Mindful Mental Health Org',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when required fields title or description are empty', async () => {
      const dto = plainToInstance(CreateInterventionResourceDto, {
        title: '',
        description: '',
        targetRiskLevels: [TargetRiskLevel.HIGH_RISK],
        mediaType: InterventionMediaType.VIDEO,
        mediaUrl: 'https://cdn.example.com/video/relax.mp4',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'title')).toBe(true);
      expect(errors.some((e) => e.property === 'description')).toBe(true);
    });

    it('should fail validation when targetRiskLevels contains an invalid enum value', async () => {
      const dto = plainToInstance(CreateInterventionResourceDto, {
        title: 'Valid Title',
        description: 'Valid Description',
        targetRiskLevels: ['INVALID_RISK_LEVEL' as any],
        mediaType: InterventionMediaType.INFOGRAPHIC,
        mediaUrl: 'https://cdn.example.com/infographic.png',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'targetRiskLevels')).toBe(true);
    });
  });

  describe('CreateEmergencyHotlineDto', () => {
    it('TC-DTO-05: should validate emergency hotline correctly', async () => {
      const dto = plainToInstance(CreateEmergencyHotlineDto, {
        organizationName: 'National Crisis Intervention Hotline',
        hotlineNumber: '1900-1122',
        is247: true,
        isPrimary: true,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when hotline number or organization name is missing', async () => {
      const dto = plainToInstance(CreateEmergencyHotlineDto, {
        isPrimary: false,
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'organizationName')).toBe(true);
      expect(errors.some((e) => e.property === 'hotlineNumber')).toBe(true);
    });
  });

  describe('ProactiveInterventionDto Contract', () => {
    it('TC-DTO-05: should instantiate ProactiveInterventionDto with valid enum constraints', () => {
      const intervention: ProactiveInterventionDto = {
        userId: 'user-intervention-001',
        riskLevel: RiskLevel.HIGH_RISK,
        riskScore: 0.88,
        triggers: [TriggerFlag.LONG_TERM_SADNESS, TriggerFlag.HIGH_ANXIETY_BURST],
        suggestedAction: SuggestedInterventionAction.MEDICAL_DOCUMENT,
        resource: {
          id: 'res-1',
          title: 'Coping with Prolonged Sadness',
          description: 'Educational guide on managing emotional fatigue.',
          mediaType: InterventionMediaType.PDF_DOCUMENT,
          mediaUrl: 'https://cdn.example.com/docs/coping.pdf',
        },
        timestamp: new Date().toISOString(),
      };

      expect(intervention.riskLevel).toBe(RiskLevel.HIGH_RISK);
      expect(intervention.suggestedAction).toBe(SuggestedInterventionAction.MEDICAL_DOCUMENT);
      expect(intervention.triggers).toContain(TriggerFlag.LONG_TERM_SADNESS);
    });
  });
});

