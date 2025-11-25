import { Injectable } from '@nestjs/common';
import { GroupEventType, InferGroupPayload } from '@repo/dtos';
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
    const updateDoc: Record<string, any> = {};

    if (payload.name !== undefined) {
      updateDoc.name = payload.name;
    }
    if (payload.description !== undefined) {
      updateDoc.description = payload.description;
    }
    if (payload.privacy !== undefined) {
      updateDoc.privacy = payload.privacy;
    }
    if (payload.avatarUrl !== undefined) {
      updateDoc.avatarUrl = payload.avatarUrl;
    }
    if (payload.members !== undefined) {
      updateDoc.members = payload.members;
    }

    if (Object.keys(updateDoc).length > 0) {
      this.groupIndexService.updatePartialDocument(payload.groupId, updateDoc);
    }
  }

  removeGroupIndex(payload: InferGroupPayload<GroupEventType.REMOVED>) {
    const { groupId } = payload;
    this.groupIndexService.deleteDocument(groupId);
  }
}
