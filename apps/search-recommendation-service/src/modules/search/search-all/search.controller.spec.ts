import { Test, TestingModule } from '@nestjs/testing';
import { SearchController } from './search.controller';
import { PostSearchService } from '../post/post-search.service';
import { GroupSearchService } from '../group/group-search.service';
import { UserSearchService } from '../user/user-search.service';

describe('SearchController', () => {
  let controller: SearchController;
  let postSearchService: { searchPosts: jest.Mock };
  let groupSearchService: { searchGroups: jest.Mock };
  let userSearchService: { searchUsers: jest.Mock };

  beforeEach(async () => {
    postSearchService = {
      searchPosts: jest.fn().mockResolvedValue({ postIds: ['p1'] }),
    };
    groupSearchService = {
      searchGroups: jest.fn().mockResolvedValue({ data: [] }),
    };
    userSearchService = {
      searchUsers: jest.fn().mockResolvedValue({ data: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        { provide: PostSearchService, useValue: postSearchService },
        { provide: GroupSearchService, useValue: groupSearchService },
        { provide: UserSearchService, useValue: userSearchService },
      ],
    }).compile();

    controller = module.get<SearchController>(SearchController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate searchPosts', async () => {
    const dto: any = { query: 'test' };
    const res = await controller.searchPosts(dto);
    expect(postSearchService.searchPosts).toHaveBeenCalledWith(dto);
    expect(res).toEqual({ postIds: ['p1'] });
  });

  it('should delegate searchGroups', async () => {
    const dto: any = { query: 'group' };
    const res = await controller.searchGroups(dto);
    expect(groupSearchService.searchGroups).toHaveBeenCalledWith(dto);
    expect(res).toEqual({ data: [] });
  });

  it('should delegate searchUsers', async () => {
    const dto: any = { query: 'user' };
    const res = await controller.searchUsers(dto);
    expect(userSearchService.searchUsers).toHaveBeenCalledWith(dto);
    expect(res).toEqual({ data: [] });
  });
});
