export class AssistantConversationDto {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  message_count?: number;
}

export class AssistantConversationListDataDto {
  items: AssistantConversationDto[];
  total: number;
  max_limit: number;
}

export class AssistantConversationListResponseDto {
  success: boolean;
  data: AssistantConversationListDataDto;
}

export class AssistantConversationResponseDto {
  success: boolean;
  data: AssistantConversationDto;
}

export class AssistantDeleteConversationResponseDto {
  success: boolean;
  data: {
    deleted: boolean;
    id: string;
  };
}
