import { Body, Controller, Get, HttpException, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CreatePostDto } from '@repo/dtos';
import { catchError } from 'rxjs';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('posts')
export class PostsController {
    constructor(
        @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
        private client: ClientProxy
    ) { }

    @Get()
    getAll() {
        return this.client.send('get_posts', {});
    }


    @Post()
    create(
        @Body() createPostDto: CreatePostDto,
        @CurrentUserId() userId: string,
    ) {
        return this.client.send('create_post', { userId, createPostDto });
    }
}
