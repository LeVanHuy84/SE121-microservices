export enum TestEventType {
  CRASH_BEFORE = 'CRASH_BEFORE',
  CRASH_DURING = 'CRASH_DURING',
  CRASH_AFTER = 'CRASH_AFTER',
  FAIL = 'FAIL',
}

export interface TestEventMessage {
  eventId: string;
  type: TestEventType;
  payload?: {
    note?: string;
  };
}
