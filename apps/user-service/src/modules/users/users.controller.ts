import { Controller, Get, Param } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';

@Controller('users')
export class UsersController {
    @MessagePattern('get_user')
    createUser(id: number) {
        return { id, name: 'Joes Lihn' }
    }
}
