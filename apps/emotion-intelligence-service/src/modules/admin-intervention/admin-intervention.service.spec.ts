import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { AdminInterventionService } from './admin-intervention.service';
import { InterventionResource } from '../../mongo/schema/intervention-resource.schema';
import { EmergencyHotline } from '../../mongo/schema/emergency-hotline.schema';
import {
  CreateEmergencyHotlineDto,
  CreateInterventionResourceDto,
  InterventionMediaType,
  TargetRiskLevel,
  UpdateEmergencyHotlineDto,
  UpdateInterventionResourceDto,
} from '@repo/dtos';

describe('AdminInterventionService', () => {
  let service: AdminInterventionService;
  let mockResourceModel: any;
  let mockHotlineModel: any;

  beforeEach(async () => {
    mockResourceModel = jest.fn<any>().mockImplementation((dto: any) => ({
      ...dto,
      save: jest.fn<any>().mockResolvedValue({ _id: 'res_new_id', ...dto }),
    }));
    mockResourceModel.find = jest.fn<any>();
    mockResourceModel.findByIdAndUpdate = jest.fn<any>();
    mockResourceModel.findByIdAndDelete = jest.fn<any>();

    mockHotlineModel = jest.fn<any>().mockImplementation((dto: any) => ({
      ...dto,
      save: jest.fn<any>().mockResolvedValue({ _id: 'hot_new_id', ...dto }),
    }));
    mockHotlineModel.find = jest.fn<any>();
    mockHotlineModel.updateMany = jest.fn<any>();
    mockHotlineModel.findByIdAndUpdate = jest.fn<any>();
    mockHotlineModel.findByIdAndDelete = jest.fn<any>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminInterventionService,
        {
          provide: getModelToken(InterventionResource.name),
          useValue: mockResourceModel,
        },
        {
          provide: getModelToken(EmergencyHotline.name),
          useValue: mockHotlineModel,
        },
      ],
    }).compile();

    service = module.get<AdminInterventionService>(AdminInterventionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Intervention Resources CRUD', () => {
    it('getResources - should return resources sorted by priority DESC and createdAt DESC', async () => {
      const mockResources = [
        { _id: 'res1', priority: 10, title: 'Resource 1' },
        { _id: 'res2', priority: 5, title: 'Resource 2' },
      ];

      const sortMock = {
        exec: jest.fn<any>().mockResolvedValue(mockResources),
      };
      mockResourceModel.find.mockReturnValue({
        sort: jest.fn<any>().mockReturnValue(sortMock),
      });

      const result = await service.getResources();

      expect(mockResourceModel.find).toHaveBeenCalled();
      expect(result).toEqual(mockResources);
    });

    it('createResource - should create and save new intervention resource', async () => {
      const dto: CreateInterventionResourceDto = {
        title: 'Meditation Guide',
        description: 'Breathing exercise',
        targetRiskLevels: [TargetRiskLevel.MILD_STRESS],
        mediaType: InterventionMediaType.INFOGRAPHIC,
        mediaUrl: 'https://example.com/meditation.png',
        priority: 5,
      };

      const result = await service.createResource(dto);

      expect(mockResourceModel).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ _id: 'res_new_id', ...dto });
    });

    it('updateResource - should update and return updated resource when found', async () => {
      const validId = '507f1f77bcf86cd799439011';
      const dto: UpdateInterventionResourceDto = { title: 'Updated Title' };
      const updatedDoc = { _id: validId, title: 'Updated Title' };

      const execMock = jest.fn<any>().mockResolvedValue(updatedDoc);
      mockResourceModel.findByIdAndUpdate.mockReturnValue({
        exec: execMock,
      });

      const result = await service.updateResource(validId, dto);

      expect(mockResourceModel.findByIdAndUpdate).toHaveBeenCalledWith(
        validId,
        dto,
        { new: true },
      );
      expect(result).toEqual(updatedDoc);
    });

    it('updateResource - should throw NotFoundException when resource is not found', async () => {
      const validId = '507f1f77bcf86cd799439012';
      const dto: UpdateInterventionResourceDto = { title: 'Updated Title' };
      const execMock = jest.fn<any>().mockResolvedValue(null);
      mockResourceModel.findByIdAndUpdate.mockReturnValue({
        exec: execMock,
      });

      await expect(service.updateResource(validId, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deleteResource - should delete and return success object when resource is found', async () => {
      const validId = '507f1f77bcf86cd799439011';
      const deletedDoc = { _id: validId, title: 'To Delete' };
      const execMock = jest.fn<any>().mockResolvedValue(deletedDoc);
      mockResourceModel.findByIdAndDelete.mockReturnValue({
        exec: execMock,
      });

      const result = await service.deleteResource(validId);

      expect(mockResourceModel.findByIdAndDelete).toHaveBeenCalledWith(validId);
      expect(result).toEqual({ success: true, deletedId: validId });
    });

    it('deleteResource - should throw NotFoundException when resource is not found', async () => {
      const validId = '507f1f77bcf86cd799439012';
      const execMock = jest.fn<any>().mockResolvedValue(null);
      mockResourceModel.findByIdAndDelete.mockReturnValue({
        exec: execMock,
      });

      await expect(service.deleteResource(validId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Emergency Hotlines CRUD', () => {
    it('getHotlines - should return hotlines sorted by isPrimary DESC and displayOrder ASC', async () => {
      const mockHotlines = [
        { _id: '507f1f77bcf86cd799439011', isPrimary: true, displayOrder: 1 },
        { _id: '507f1f77bcf86cd799439012', isPrimary: false, displayOrder: 2 },
      ];

      const sortMock = {
        exec: jest.fn<any>().mockResolvedValue(mockHotlines),
      };
      mockHotlineModel.find.mockReturnValue({
        sort: jest.fn<any>().mockReturnValue(sortMock),
      });

      const result = await service.getHotlines();

      expect(mockHotlineModel.find).toHaveBeenCalled();
      expect(result).toEqual(mockHotlines);
    });

    it('createHotline - should reset existing primary hotlines if new hotline isPrimary is true', async () => {
      const dto: CreateEmergencyHotlineDto = {
        organizationName: 'Crisis Center',
        hotlineNumber: '115',
        is247: true,
        isPrimary: true,
      };

      const execMock = jest.fn<any>().mockResolvedValue({ acknowledged: true });
      mockHotlineModel.updateMany.mockReturnValue({ exec: execMock });

      const result = await service.createHotline(dto);

      expect(mockHotlineModel.updateMany).toHaveBeenCalledWith(
        {},
        { isPrimary: false },
      );
      expect(mockHotlineModel).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ _id: 'hot_new_id', ...dto });
    });

    it('createHotline - should NOT reset existing primary hotlines if new hotline isPrimary is false', async () => {
      const dto: CreateEmergencyHotlineDto = {
        organizationName: 'Local Support',
        hotlineNumber: '19001234',
        is247: false,
        isPrimary: false,
      };

      const result = await service.createHotline(dto);

      expect(mockHotlineModel.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ _id: 'hot_new_id', ...dto });
    });

    it('updateHotline - should reset other primary hotlines if dto.isPrimary is true', async () => {
      const validId = '507f1f77bcf86cd799439013';
      const dto: UpdateEmergencyHotlineDto = {
        isPrimary: true,
      };
      const updatedDoc = { _id: validId, isPrimary: true };

      const updateManyExecMock = jest
        .fn<any>()
        .mockResolvedValue({ acknowledged: true });
      mockHotlineModel.updateMany.mockReturnValue({ exec: updateManyExecMock });

      const updateExecMock = jest.fn<any>().mockResolvedValue(updatedDoc);
      mockHotlineModel.findByIdAndUpdate.mockReturnValue({
        exec: updateExecMock,
      });

      const result = await service.updateHotline(validId, dto);

      expect(mockHotlineModel.updateMany).toHaveBeenCalledWith(
        { _id: { $ne: validId } },
        { isPrimary: false },
      );
      expect(mockHotlineModel.findByIdAndUpdate).toHaveBeenCalledWith(
        validId,
        dto,
        { new: true },
      );
      expect(result).toEqual(updatedDoc);
    });

    it('updateHotline - should throw NotFoundException when hotline is not found', async () => {
      const validId = '507f1f77bcf86cd799439012';
      const dto: UpdateEmergencyHotlineDto = { hotlineNumber: '999' };
      const execMock = jest.fn<any>().mockResolvedValue(null);
      mockHotlineModel.findByIdAndUpdate.mockReturnValue({ exec: execMock });

      await expect(service.updateHotline(validId, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deleteHotline - should delete and return success object when hotline is found', async () => {
      const validId = '507f1f77bcf86cd799439013';
      const deletedDoc = { _id: validId, organizationName: 'Support' };
      const execMock = jest.fn<any>().mockResolvedValue(deletedDoc);
      mockHotlineModel.findByIdAndDelete.mockReturnValue({ exec: execMock });

      const result = await service.deleteHotline(validId);

      expect(mockHotlineModel.findByIdAndDelete).toHaveBeenCalledWith(validId);
      expect(result).toEqual({ success: true, deletedId: validId });
    });

    it('deleteHotline - should throw NotFoundException when hotline is not found', async () => {
      const validId = '507f1f77bcf86cd799439012';
      const execMock = jest.fn<any>().mockResolvedValue(null);
      mockHotlineModel.findByIdAndDelete.mockReturnValue({ exec: execMock });

      await expect(service.deleteHotline(validId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
