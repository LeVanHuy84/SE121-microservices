import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { UserService } from './user.service';

import { CreateUserDTO, UpdateUserDTO, UserResponseDTO } from '@repo/dtos';
import { plainToInstance } from 'class-transformer';



@Controller()
export class UserController {
  constructor(private readonly userService: UserService) { }

  @MessagePattern('createUser')
  async create(@Payload() createUserDto: CreateUserDTO) {
    return this.userService.create(createUserDto);
    
  }

  @MessagePattern('findAllUser')
  async findAll(){
    return this.userService.findAll();
    
  }

  @MessagePattern('findOneUser')
  async findOne(@Payload() id: string) {
    return this.userService.findOne(id);
  }

  @MessagePattern('updateUser')
  async update(@Payload() id: string, updateUserDto: UpdateUserDTO){
    return this.userService.update(id, updateUserDto);
   
  }

  @MessagePattern('removeUser')
  remove(@Payload() id: string) {
    return this.userService.remove(id);
  }
}
