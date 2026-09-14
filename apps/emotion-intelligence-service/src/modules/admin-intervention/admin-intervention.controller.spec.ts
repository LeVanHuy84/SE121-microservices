/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AdminInterventionController } from './admin-intervention.controller';
import { AdminInterventionService } from './admin-intervention.service';
import {
  CreateEmergencyHotlineDto,
  CreateInterventionResourceDto,
  InterventionMediaType,
  TargetRiskLevel,
  UpdateEmergencyHotlineDto,
  UpdateInterventionResourceDto,
} from '@repo/dtos';

describe('AdminInterventionController', () => {
  let controller: AdminInterventionController;
  let service: jest.Mocked<AdminInterventionService>;

  beforeEach(async () => {
    const mockService = {
      getResources: jest.fn(),
      createResource: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
      getHotlines: jest.fn(),
      createHotline: jest.fn(),
      updateHotline: jest.fn(),
      deleteHotline: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminInterventionController],
      providers: [
        {
          provide: AdminInterventionService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AdminInterventionController>(
      AdminInterventionController,
    );
    service = module.get(AdminInterventionService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getResources', () => {
    it('should delegate getResources call to service', async () => {
      const mockResult = [{ title: 'Resource 1' }] as any;
      service.getResources.mockResolvedValue(mockResult);

      const result = await controller.getResources();
      expect(() => service.getResources).not.toThrow();
      expect(service.getResources).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockResult);
    });
  });

  describe('createResource', () => {
    it('should delegate createResource call with payload dto', async () => {
      const dto: CreateInterventionResourceDto = {
        title: 'Deep Breathing',
        description: 'Breathing exercise',
        targetRiskLevels: [TargetRiskLevel.MODERATE_RISK],
        mediaType: InterventionMediaType.INFOGRAPHIC,
        mediaUrl: 'https://example.com/breath.png',
      };
      const mockCreated = { id: 'res123', ...dto } as any;
      service.createResource.mockResolvedValue(mockCreated);

      const result = await controller.createResource(dto);
      expect(() => service.createResource).not.toThrow();
      expect(service.createResource).toHaveBeenCalledWith(dto);
      expect(result).toBe(mockCreated);
    });
  });

  describe('updateResource', () => {
    it('should delegate updateResource call with id and dto payload', async () => {
      const dto: UpdateInterventionResourceDto = {
        title: 'Updated Title',
      };
      const mockUpdated = { id: 'res123', title: 'Updated Title' } as any;
      service.updateResource.mockResolvedValue(mockUpdated);

      const result = await controller.updateResource({
        id: 'res123',
        dto,
      });

      expect(() => service.updateResource).not.toThrow();
      expect(service.updateResource).toHaveBeenCalledWith('res123', dto);
      expect(result).toBe(mockUpdated);
    });
  });

  describe('deleteResource', () => {
    it('should delegate deleteResource call with id payload', async () => {
      const mockRes = { success: true, deletedId: 'res123' };
      service.deleteResource.mockResolvedValue(mockRes);

      const result = await controller.deleteResource({ id: 'res123' });
      expect(() => service.deleteResource).not.toThrow();
      expect(service.deleteResource).toHaveBeenCalledWith('res123');
      expect(result).toEqual(mockRes);
    });
  });

  describe('getHotlines', () => {
    it('should delegate getHotlines call to service', async () => {
      const mockList = [{ organizationName: '115' }] as any;
      service.getHotlines.mockResolvedValue(mockList);

      const result = await controller.getHotlines();
      expect(() => service.getHotlines).not.toThrow();
      expect(service.getHotlines).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockList);
    });
  });

  describe('createHotline', () => {
    it('should delegate createHotline call with payload dto', async () => {
      const dto: CreateEmergencyHotlineDto = {
        organizationName: 'National Hotline',
        hotlineNumber: '111',
        is247: true,
        isPrimary: true,
      };
      const mockCreated = { id: 'hot123', ...dto } as any;
      service.createHotline.mockResolvedValue(mockCreated);

      const result = await controller.createHotline(dto);
      expect(() => service.createHotline).not.toThrow();
      expect(service.createHotline).toHaveBeenCalledWith(dto);
      expect(result).toBe(mockCreated);
    });
  });

  describe('updateHotline', () => {
    it('should delegate updateHotline call with id and dto payload', async () => {
      const dto: UpdateEmergencyHotlineDto = {
        hotlineNumber: '115',
      };
      const mockUpdated = { id: 'hot123', hotlineNumber: '115' } as any;
      service.updateHotline.mockResolvedValue(mockUpdated);

      const result = await controller.updateHotline({
        id: 'hot123',
        dto,
      });

      expect(() => service.updateHotline).not.toThrow();
      expect(service.updateHotline).toHaveBeenCalledWith('hot123', dto);
      expect(result).toBe(mockUpdated);
    });
  });

  describe('deleteHotline', () => {
    it('should delegate deleteHotline call with id payload', async () => {
      const mockRes = { success: true, deletedId: 'hot123' };
      service.deleteHotline.mockResolvedValue(mockRes);

      const result = await controller.deleteHotline({ id: 'hot123' });
      expect(() => service.deleteHotline).not.toThrow();
      expect(service.deleteHotline).toHaveBeenCalledWith('hot123');
      expect(result).toEqual(mockRes);
    });
  });
});
