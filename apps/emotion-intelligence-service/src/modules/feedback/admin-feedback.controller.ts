import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AdminFeedbackService } from './admin-feedback.service';

@Controller()
export class AdminFeedbackController {
  constructor(private readonly adminService: AdminFeedbackService) {}

  @MessagePattern('emotion-admin.feedback.list')
  async list(@Payload() payload: any) {
    return this.adminService.list(payload || {});
  }

  @MessagePattern('emotion-admin.feedback.accuracy')
  async accuracy(@Payload() _payload: any) {
    return this.adminService.accuracy();
  }
}
