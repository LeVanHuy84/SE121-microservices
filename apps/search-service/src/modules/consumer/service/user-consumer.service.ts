import { Injectable } from '@nestjs/common';
import { InferUserPayload, UserEventType } from '@repo/dtos';
import { UserIndexService } from 'src/modules/user/user-index.service';

@Injectable()
export class UserConsumerService {
  constructor(private readonly userIndexService: UserIndexService) {}

  createUserIndex(payload: InferUserPayload<UserEventType.CREATED>) {
    const { userId, email, firstName, lastName, avatarUrl, bio, createdAt } =
      payload;
    this.userIndexService.indexDocument(userId, {
      id: userId,
      email,
      firstName,
      lastName,
      avatarUrl,
      bio,
      createdAt,
      fullName: `${firstName} ${lastName}`,
    });
  }

  updateUserIndex(payload: InferUserPayload<UserEventType.UPDATED>) {
    const updateDoc: Record<string, any> = {};

    if (payload.email !== undefined) {
      updateDoc.email = payload.email;
    }

    if (payload.firstName !== undefined) {
      updateDoc.firstName = payload.firstName;
    }

    if (payload.lastName !== undefined) {
      updateDoc.lastName = payload.lastName;
    }

    if (payload.avatarUrl !== undefined) {
      updateDoc.avatarUrl = payload.avatarUrl;
    }

    if (payload.bio !== undefined) {
      updateDoc.bio = payload.bio;
    }

    if (payload.firstName !== undefined || payload.lastName !== undefined) {
      const first = payload.firstName ?? '';
      const last = payload.lastName ?? '';
      updateDoc.fullName = `${first} ${last}`.trim();
    }

    if (Object.keys(updateDoc).length > 0) {
      return this.userIndexService.updatePartialDocument(
        payload.userId,
        updateDoc,
      );
    }
  }

  removeUserIndex(payload: InferUserPayload<UserEventType.REMOVED>) {
    const { userId } = payload;
    this.userIndexService.deleteDocument(userId);
  }
}
