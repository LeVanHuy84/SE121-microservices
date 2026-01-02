import {
  Controller,
  Inject
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';

@Controller('media')
export class MediaController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.MEDIA_SERVICE)
    private readonly mediaClient: ClientProxy
  ) {}

}
