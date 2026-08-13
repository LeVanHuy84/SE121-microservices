declare module 'amqplib' {
  export interface Channel {
    assertExchange(exchange: string, type: string, options?: any): Promise<any>;
    assertQueue(queue: string, options?: any): Promise<any>;
    bindQueue(queue: string, source: string, pattern: string, args?: any): Promise<any>;
    publish(exchange: string, routingKey: string, content: Buffer, options?: any): boolean;
    sendToQueue(queue: string, content: Buffer, options?: any): boolean;
    consume(queue: string, onMessage: (msg: any) => any, options?: any): Promise<any>;
    ack(message: any): void;
    nack(message: any, allUpTo?: boolean, requeue?: boolean): void;
  }
}
