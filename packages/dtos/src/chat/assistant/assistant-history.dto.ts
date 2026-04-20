export class ChatbotHistoryMessageDto {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  intent?: string | null;
  sources: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export class ChatbotHistoryDataDto {
  items: ChatbotHistoryMessageDto[];
  next_cursor_created_at: string | null;
  next_cursor_id: string | null;
  has_more: boolean;
}

export class ChatbotHistoryResponseDto {
  success: boolean;
  data: ChatbotHistoryDataDto;
}

export class ChatbotClearHistoryDataDto {
  deleted_count: number;
  session_cleared: boolean;
}

export class ChatbotClearHistoryResponseDto {
  success: boolean;
  data: ChatbotClearHistoryDataDto;
}
