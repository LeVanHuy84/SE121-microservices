import { TcpMessagePattern } from '@repo/common';
import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { AdminInterventionService } from './admin-intervention.service';
import {
  CreateEmergencyHotlineDto,
  CreateInterventionResourceDto,
  UpdateEmergencyHotlineDto,
  UpdateInterventionResourceDto,
} from '@repo/dtos';

@Controller()
export class AdminInterventionController {
  constructor(
    private readonly adminInterventionService: AdminInterventionService,
  ) {}

  // --- Intervention Resources TCP Handlers ---
  @TcpMessagePattern('emotion-admin.intervention.resource.list')
  async getResources() {
    return this.adminInterventionService.getResources();
  }

  @TcpMessagePattern('emotion-admin.intervention.resource.create')
  async createResource(@Payload() dto: CreateInterventionResourceDto) {
    return this.adminInterventionService.createResource(dto);
  }

  @TcpMessagePattern('emotion-admin.intervention.resource.update')
  async updateResource(
    @Payload() payload: { id: string; dto: UpdateInterventionResourceDto },
  ) {
    return this.adminInterventionService.updateResource(
      payload.id,
      payload.dto,
    );
  }

  @TcpMessagePattern('emotion-admin.intervention.resource.delete')
  async deleteResource(@Payload() payload: { id: string }) {
    return this.adminInterventionService.deleteResource(payload.id);
  }

  // --- Emergency Hotlines TCP Handlers ---
  @TcpMessagePattern('emotion-admin.intervention.hotline.list')
  async getHotlines() {
    return this.adminInterventionService.getHotlines();
  }

  @TcpMessagePattern('emotion-admin.intervention.hotline.create')
  async createHotline(@Payload() dto: CreateEmergencyHotlineDto) {
    return this.adminInterventionService.createHotline(dto);
  }

  @TcpMessagePattern('emotion-admin.intervention.hotline.update')
  async updateHotline(
    @Payload() payload: { id: string; dto: UpdateEmergencyHotlineDto },
  ) {
    return this.adminInterventionService.updateHotline(payload.id, payload.dto);
  }

  @TcpMessagePattern('emotion-admin.intervention.hotline.delete')
  async deleteHotline(@Payload() payload: { id: string }) {
    return this.adminInterventionService.deleteHotline(payload.id);
  }
}
