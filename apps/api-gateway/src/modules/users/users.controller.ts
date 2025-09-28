import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';

@Controller('users')
export class UsersController {
    constructor(
        @Inject(MICROSERVICES_CLIENTS.USER_SERVICE)
        private userServiceClient: ClientProxy
    ) { }

    @Get(':id')
    findAll(@Param('id') id: number) {
        return this.userServiceClient.send('get_user', id);
    }
}
