import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { of } from 'rxjs';
import { AdminInterventionController } from './admin-intervention.controller';
import { MICROSERVICES_CLIENTS } from '../../common/constants';
import {
  CreateEmergencyHotlineDto,
  CreateInterventionResourceDto,
  InterventionMediaType,
  TargetRiskLevel,
  UpdateEmergencyHotlineDto,
  UpdateInterventionResourceDto,
} from '@repo/dtos';

describe('AdminInterventionController (API Gateway)', () => {
  let controller: AdminInterventionController;
  let mockClientProxy: any;

  beforeEach(async () => {
    mockClientProxy = {
      send: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminInterventionController],
      providers: [
        {
          provide: MICROSERVICES_CLIENTS.EMOTION_INTELLIGENCE_SERVICE,
          useValue: mockClientProxy,
        },
      ],
    }).compile();

    controller = module.get<AdminInterventionController>(
      AdminInterventionController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getInterventionResources', () => {
    it('should send emotion-admin.intervention.resource.list pattern to microservice', async () => {
      const mockResources = [{ id: 'res1', title: 'Resource 1' }];
      mockClientProxy.send.mockReturnValue(of(mockResources));

      const result = await controller.getInterventionResources();

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        'emotion-admin.intervention.resource.list',
        {},
      );
      expect(result).toEqual(mockResources);
    });
  });

  describe('createInterventionResource', () => {
    it('should send emotion-admin.intervention.resource.create pattern with dto', async () => {
      const dto: CreateInterventionResourceDto = {
        title: 'Deep Breathing',
        description: 'Breathing exercise',
        targetRiskLevels: [TargetRiskLevel.MODERATE_RISK],
        mediaType: InterventionMediaType.INFOGRAPHIC,
        mediaUrl: 'https://example.com/breath.png',
      };
      const mockCreated = { id: 'res123', ...dto };
      mockClientProxy.send.mockReturnValue(of(mockCreated));

      const result = await controller.createInterventionResource(dto);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        'emotion-admin.intervention.resource.create',
        dto,
      );
      expect(result).toEqual(mockCreated);
    });
  });

  describe('updateInterventionResource', () => {
    it('should send emotion-admin.intervention.resource.update pattern with id and dto', async () => {
      const dto: UpdateInterventionResourceDto = { title: 'Updated Title' };
      const mockUpdated = { id: 'res123', title: 'Updated Title' };
      mockClientProxy.send.mockReturnValue(of(mockUpdated));

      const result = await controller.updateInterventionResource('res123', dto);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        'emotion-admin.intervention.resource.update',
        { id: 'res123', dto },
      );
      expect(result).toEqual(mockUpdated);
    });
  });

  describe('deleteInterventionResource', () => {
    it('should send emotion-admin.intervention.resource.delete pattern with id', async () => {
      const mockResponse = { success: true, deletedId: 'res123' };
      mockClientProxy.send.mockReturnValue(of(mockResponse));

      const result = await controller.deleteInterventionResource('res123');

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        'emotion-admin.intervention.resource.delete',
        { id: 'res123' },
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getEmergencyHotlines', () => {
    it('should send emotion-admin.intervention.hotline.list pattern to microservice', async () => {
      const mockHotlines = [{ id: 'hot1', organizationName: '115' }];
      mockClientProxy.send.mockReturnValue(of(mockHotlines));

      const result = await controller.getEmergencyHotlines();

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        'emotion-admin.intervention.hotline.list',
        {},
      );
      expect(result).toEqual(mockHotlines);
    });
  });

  describe('createEmergencyHotline', () => {
    it('should send emotion-admin.intervention.hotline.create pattern with dto', async () => {
      const dto: CreateEmergencyHotlineDto = {
        organizationName: 'Hotline 115',
        hotlineNumber: '115',
        is247: true,
      };
      const mockCreated = { id: 'hot123', ...dto };
      mockClientProxy.send.mockReturnValue(of(mockCreated));

      const result = await controller.createEmergencyHotline(dto);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        'emotion-admin.intervention.hotline.create',
        dto,
      );
      expect(result).toEqual(mockCreated);
    });
  });

  describe('updateEmergencyHotline', () => {
    it('should send emotion-admin.intervention.hotline.update pattern with id and dto', async () => {
      const dto: UpdateEmergencyHotlineDto = { hotlineNumber: '115' };
      const mockUpdated = { id: 'hot123', hotlineNumber: '115' };
      mockClientProxy.send.mockReturnValue(of(mockUpdated));

      const result = await controller.updateEmergencyHotline('hot123', dto);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        'emotion-admin.intervention.hotline.update',
        { id: 'hot123', dto },
      );
      expect(result).toEqual(mockUpdated);
    });
  });

  describe('deleteEmergencyHotline', () => {
    it('should send emotion-admin.intervention.hotline.delete pattern with id', async () => {
      const mockResponse = { success: true, deletedId: 'hot123' };
      mockClientProxy.send.mockReturnValue(of(mockResponse));

      const result = await controller.deleteEmergencyHotline('hot123');

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        'emotion-admin.intervention.hotline.delete',
        { id: 'hot123' },
      );
      expect(result).toEqual(mockResponse);
    });
  });
});
