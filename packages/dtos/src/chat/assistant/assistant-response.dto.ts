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

export class AssistantCardPayloadDto {
  cardType: 'profile' | 'group' | 'post' | 'music' | 'emotion';
  title: string;
  subtitle?: string;
  imageUrl?: string;
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, unknown>;
}

export class AssistantShowCardActionDto {
  type: 'show_card';
  id: string;
  label: string;
  payload: AssistantCardPayloadDto;
}

export class AssistantProposeActionPayloadDto {
  actionName: string;
  title: string;
  description: string;
  params?: Record<string, unknown>;
  idempotencyKey: string;
  confirmLabel?: string;
  cancelLabel?: string;
  category?: string;
  isDestructive?: boolean;
  expiresAt?: string;
}

export class AssistantProposeActionDto {
  type: 'propose_action';
  id: string;
  label: string;
  payload: AssistantProposeActionPayloadDto;
}

export class AssistantCrisisInfoDto {
  category?: string;
  severity?: string;
  helplines?: Array<{
    name: string;
    phone: string;
    available?: string;
    description?: string;
  }>;
  suggestedAction?: string;
}

export class AssistantRespondDataDto {
  type?: string;
  reply: string;
  sources: AssistantSourceDto[];
  suggestedActions: AssistantSuggestedActionDto[];
  cards?: AssistantShowCardActionDto[];
  proposals?: AssistantProposeActionDto[];
  crisis?: AssistantCrisisInfoDto;
  model: string;
  provider: string;
  requestId?: string;
  latencyMs?: number;
  persisted?: boolean;
  conversationId?: string;
  policyBlocked?: boolean;
}

export class AssistantRespondResponseDto {
  success: boolean;
  data: AssistantRespondDataDto;
}
