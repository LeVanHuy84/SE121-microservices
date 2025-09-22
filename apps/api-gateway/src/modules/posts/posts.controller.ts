import { Body, Controller, Delete, Get, HttpException, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CreatePostDto, GetPostQueryDto, PaginationDto } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { Public } from 'src/common/decorators/public.decorator';

@Controller('posts')
export class PostsController {
    constructor(
        @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
        private client: ClientProxy
    ) { }

    @Post()
    create(
        @Body() createPostDto: CreatePostDto,
        @CurrentUserId() userId: string,
    ) {
        return this.client.send('create_post', { userId, createPostDto });
    }

    @Get('post/:id')
    getById(@Param('id') postId: string) {
        return this.client.send('get_post_by_id', postId);
    }

    @Get('user/:id')
    getByUser(
        @Param('id') userId: string,
        @Query() pagination: GetPostQueryDto,
        @CurrentUserId() currentUserId: string,
    ) {
        return this.client.send('get_posts_by_user', { userId, pagination, currentUserId });
    }

    @Patch('update/:id')
    update(
        @Param('id') postId: string,
        @Body() updatePostDto: Partial<CreatePostDto>,
        @CurrentUserId() userId: string,
    ) {
        return this.client.send('update_post', { userId, postId, updatePostDto });
    }

    @Patch('update-status/:id')
    updatePostStatus(
        @Param('id') postId: string,
        @CurrentUserId() userId: string,
    ) {
        return this.client.send('update_post_status', { userId, postId });
    }

    @Delete('delete/:id')
    deletePost(
        @Param('id') id: string,
        @CurrentUserId() userId: string,
    ) {
        return this.client.send('delete_post', { id, userId });
    }
}
