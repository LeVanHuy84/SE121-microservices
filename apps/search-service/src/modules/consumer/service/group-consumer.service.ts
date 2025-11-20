import { Injectable } from '@nestjs/common';
import {
  GroupEventType,
  InferGroupPayload,
  InferPostPayload,
} from '@repo/dtos';
import { GroupIndexService } from 'src/modules/group/group-index.service';

@Injectable()
export class GroupConsumerService {
  constructor(private readonly groupIndexService: GroupIndexService) {}

  createGroupIndex(payload: InferGroupPayload<GroupEventType.CREATED>) {
    const {
      groupId,
      name,
      description,
      privacy,
      avatarUrl,
      members,
      createdAt,
    } = payload;
    this.groupIndexService.indexDocument(groupId, {
      id: groupId,
      name,
      description,
      privacy,
      avatarUrl,
      members,
      createdAt,
    });
  }

  updateGroupIndex(payload: InferGroupPayload<GroupEventType.UPDATED>) {
    const { groupId, name, description, privacy, avatarUrl, members } = payload;
    this.groupIndexService.updatePartialDocument(groupId, {
      name,
      description,
      privacy,
      avatarUrl,
      members,
    });
  }

  removeGroupIndex(payload: InferGroupPayload<GroupEventType.REMOVED>) {
    const { groupId } = payload;
    this.groupIndexService.deleteDocument(groupId);
  }
}
