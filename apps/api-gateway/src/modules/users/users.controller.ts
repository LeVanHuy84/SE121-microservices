import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { Public } from 'src/common/decorators/public.decorator';
import { CreateUserDTO, UpdateUserDTO, UserResponseDTO } from '@repo/dtos';
import { Observable } from 'rxjs';
@Controller('users')
export class UsersController {
    constructor(
        @Inject(MICROSERVICES_CLIENTS.USER_SERVICE)
        private client: ClientProxy
    ) { }

    @Public()
    @Post()
    create(@Body() createUserDto: CreateUserDTO)  {
        return this.client.send('createUser', createUserDto);
    }

    @Public()
    @Get()
    findAll() : Observable<UserResponseDTO[]> {
        return this.client.send<UserResponseDTO[]>('findAllUser', {});
    }

    @Get(':id')
    findOne(@Param('id') id: string)  {
        return this.client.send<UserResponseDTO>('findOneUser', id);
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDTO)  {
        return this.client.send('updateUser', { id, dto: updateUserDto });
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.client.send('removeUser', id);
    }
}
