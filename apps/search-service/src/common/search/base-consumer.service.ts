import { Logger } from '@nestjs/common';

export abstract class BaseConsumerService {
  protected readonly logger = new Logger(this.constructor.name);

  // Map topic → function
  abstract handlers: Record<string, (value: any) => Promise<void>>;

  async handleMessage(topic: string, message: any) {
    const handler = this.handlers[topic];

    if (!handler) {
      this.logger.warn(`No handler for topic: ${topic}`);
      return;
    }

    try {
      await handler.call(this, message);
    } catch (err) {
      this.logger.error(`Error processing ${topic}: ${err}`);
      throw err;
    }
  }
}
