export type MediaProviderName = 'stream';

export interface CallMediaProvider {
  readonly name: MediaProviderName;
  registerCall(params: {
    callId: string;
    conversationId: string;
    initiatorId: string;
    participants: string[];
    moderatorUserIds: string[];
  }): Promise<void>;
  issueUserToken(userId: string): Promise<string>;
}
