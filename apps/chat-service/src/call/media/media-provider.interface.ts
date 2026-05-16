import { CallMediaTokenResponseDTO } from '@repo/dtos';

export type MediaProviderName = 'stream';

export interface IssueMediaTokenContext {
  userId: string;
  preferAudioOnly?: boolean;
  call: any;
  moderatorUserIds: string[];
}

export interface CallMediaProvider {
  readonly name: MediaProviderName;
  issueParticipantToken(
    context: IssueMediaTokenContext,
  ): Promise<CallMediaTokenResponseDTO>;
}
