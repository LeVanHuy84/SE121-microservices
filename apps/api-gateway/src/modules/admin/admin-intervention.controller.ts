import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom } from "rxjs";
import {
  CreateEmergencyHotlineDto,
  CreateInterventionResourceDto,
  SystemRole,
  UpdateEmergencyHotlineDto,
  UpdateInterventionResourceDto,
} from "@repo/dtos";
import { MICROSERVICES_CLIENTS } from "src/common/constants";
import { RequireRole } from "src/common/decorators/require-role.decorator";

@Controller("admin/interventions")
export class AdminInterventionController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.EMOTION_INTELLIGENCE_SERVICE)
    private readonly client: ClientProxy,
  ) {}

  // --- Intervention Resources Endpoints ---
  @Get("resources")
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  async getInterventionResources() {
    return await firstValueFrom(
      this.client.send("emotion-admin.intervention.resource.list", {}),
    );
  }

  @Post("resources")
  @RequireRole(SystemRole.ADMIN)
  async createInterventionResource(
    @Body() dto: CreateInterventionResourceDto,
  ) {
    return await firstValueFrom(
      this.client.send("emotion-admin.intervention.resource.create", dto),
    );
  }

  @Put("resources/:id")
  @RequireRole(SystemRole.ADMIN)
  async updateInterventionResource(
    @Param("id") id: string,
    @Body() dto: UpdateInterventionResourceDto,
  ) {
    return await firstValueFrom(
      this.client.send("emotion-admin.intervention.resource.update", {
        id,
        dto,
      }),
    );
  }

  @Delete("resources/:id")
  @RequireRole(SystemRole.ADMIN)
  async deleteInterventionResource(@Param("id") id: string) {
    return await firstValueFrom(
      this.client.send("emotion-admin.intervention.resource.delete", { id }),
    );
  }

  // --- Emergency Hotlines Endpoints ---
  @Get("hotlines")
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  async getEmergencyHotlines() {
    return await firstValueFrom(
      this.client.send("emotion-admin.intervention.hotline.list", {}),
    );
  }

  @Post("hotlines")
  @RequireRole(SystemRole.ADMIN)
  async createEmergencyHotline(@Body() dto: CreateEmergencyHotlineDto) {
    return await firstValueFrom(
      this.client.send("emotion-admin.intervention.hotline.create", dto),
    );
  }

  @Put("hotlines/:id")
  @RequireRole(SystemRole.ADMIN)
  async updateEmergencyHotline(
    @Param("id") id: string,
    @Body() dto: UpdateEmergencyHotlineDto,
  ) {
    return await firstValueFrom(
      this.client.send("emotion-admin.intervention.hotline.update", {
        id,
        dto,
      }),
    );
  }

  @Delete("hotlines/:id")
  @RequireRole(SystemRole.ADMIN)
  async deleteEmergencyHotline(@Param("id") id: string) {
    return await firstValueFrom(
      this.client.send("emotion-admin.intervention.hotline.delete", { id }),
    );
  }
}
