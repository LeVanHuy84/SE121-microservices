import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UserPreferenceService } from './user-preference.service';


@Controller()
export class UserPreferenceController {
  constructor(private readonly userPreferenceService: UserPreferenceService) {}

}
