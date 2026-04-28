export class AssistantSourceDto {
  type: string;
  id: string;
  title?: string;
  source?: string;
  score?: number;
}

export class AssistantSuggestedActionDto {
  type: string;
  label: string;
  payload: Record<string, unknown>;
}

export class AssistantRespondDataDto {
  reply: string;
  sources: AssistantSourceDto[];
  suggestedActions: AssistantSuggestedActionDto[];
  model: string;
  provider: string;
}

export class AssistantRespondResponseDto {
  success: boolean;
  data: AssistantRespondDataDto;
}
