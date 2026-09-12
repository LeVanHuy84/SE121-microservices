import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

  // --- Intervention Resources CRUD ---
  async getResources() {
    return this.resourceModel.find().sort({ priority: -1, createdAt: -1 }).exec();
  }

  async createResource(dto: CreateInterventionResourceDto) {
    const newResource = new this.resourceModel(dto);
    return newResource.save();
  }

  async updateResource(id: string, dto: UpdateInterventionResourceDto) {
    const updated = await this.resourceModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException(`Intervention Resource with ID ${id} not found`);
    }
    return updated;
  }

  async deleteResource(id: string) {
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
    const deleted = await this.hotlineModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Emergency Hotline with ID ${id} not found`);
    }
    return { success: true, deletedId: id };
  }
}
