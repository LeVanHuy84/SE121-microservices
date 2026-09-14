import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateEmergencyHotlineDto,
  CreateInterventionResourceDto,
  UpdateEmergencyHotlineDto,
  UpdateInterventionResourceDto,
} from '@repo/dtos';
import {
  InterventionResource,
  InterventionResourceDocument,
} from 'src/mongo/schema/intervention-resource.schema';
import {
  EmergencyHotline,
  EmergencyHotlineDocument,
} from 'src/mongo/schema/emergency-hotline.schema';

@Injectable()
export class AdminInterventionService {
  private readonly logger = new Logger(AdminInterventionService.name);

  constructor(
    @InjectModel(InterventionResource.name)
    private readonly resourceModel: Model<InterventionResourceDocument>,
    @InjectModel(EmergencyHotline.name)
    private readonly hotlineModel: Model<EmergencyHotlineDocument>,
  ) {}

  private validateObjectId(id: string) {
    if (!id || id === 'undefined' || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ID format: ${id}`);
    }
  }

  // --- Intervention Resources CRUD ---
  async getResources() {
    return this.resourceModel.find().sort({ priority: -1, createdAt: -1 }).exec();
  }

  async createResource(dto: CreateInterventionResourceDto) {
    const newResource = new this.resourceModel(dto);
    return newResource.save();
  }

  async updateResource(id: string, dto: UpdateInterventionResourceDto) {
    this.validateObjectId(id);
    const updated = await this.resourceModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException(`Intervention Resource with ID ${id} not found`);
    }
    return updated;
  }

  async deleteResource(id: string) {
    this.validateObjectId(id);
    const deleted = await this.resourceModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Intervention Resource with ID ${id} not found`);
    }
    return { success: true, deletedId: id };
  }

  // --- Emergency Hotlines CRUD ---
  async getHotlines() {
    return this.hotlineModel.find().sort({ isPrimary: -1, displayOrder: 1 }).exec();
  }

  async createHotline(dto: CreateEmergencyHotlineDto) {
    if (dto.isPrimary) {
      await this.hotlineModel.updateMany({}, { isPrimary: false }).exec();
    }
    const newHotline = new this.hotlineModel(dto);
    return newHotline.save();
  }

  async updateHotline(id: string, dto: UpdateEmergencyHotlineDto) {
    this.validateObjectId(id);
    if (dto.isPrimary) {
      await this.hotlineModel.updateMany({ _id: { $ne: id } }, { isPrimary: false }).exec();
    }
    const updated = await this.hotlineModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException(`Emergency Hotline with ID ${id} not found`);
    }
    return updated;
  }

  async deleteHotline(id: string) {
    this.validateObjectId(id);
    const deleted = await this.hotlineModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Emergency Hotline with ID ${id} not found`);
    }
    return { success: true, deletedId: id };
  }
}
