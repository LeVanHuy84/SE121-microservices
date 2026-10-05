import { EventTopic } from './event.enum';

export class ChatbotCrisisAlertPayload {
  userId: string;
  conversationId: string;
  riskLevel: string;
  reason: string;
  timestamp: string | Date;
}

export class ChatbotCrisisAlertEvent {
  type: string;
  payload: ChatbotCrisisAlertPayload;
}
