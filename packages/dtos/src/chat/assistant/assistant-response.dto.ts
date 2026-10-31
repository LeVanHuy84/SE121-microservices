export class AssistantSourceDto {
  type: string;
  id: string;
  title?: string;
  source?: string;
  score?: number;
}

export class AssistantNavigatePayloadDto {
  destinationId: string;
  params?: Record<string, string>;
}

export class AssistantNavigateActionDto {
  type: 'navigate';
  id: string;
  label: string;
  payload: AssistantNavigatePayloadDto;
}

export class AssistantSuggestedActionDto {
  type: string;
  id?: string;
  label: string;
  payload: Record<string, unknown>;
}

export class AssistantRespondDataDto {
  type?: string;
  reply: string;
  sources: AssistantSourceDto[];
  suggestedActions: AssistantSuggestedActionDto[];
  model: string;
  provider: string;
  requestId?: string;
  latencyMs?: number;
  persisted?: boolean;
  conversationId?: string;
}

export class AssistantRespondResponseDto {
  success: boolean;
  data: AssistantRespondDataDto;
}
