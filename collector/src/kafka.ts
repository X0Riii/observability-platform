import { Kafka, Producer } from 'kafkajs';

export class KafkaProducer {
  private kafka: Kafka;
  private producer: Producer;

  constructor(clientId: string, brokers: string[]) {
    this.kafka = new Kafka({ clientId, brokers });
    this.producer = this.kafka.producer();
  }

  async connect(): Promise<void> {
    await this.producer.connect();
    console.log('[Kafka] Producer connected');
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
    console.log('[Kafka] Producer disconnected');
  }

  async sendEvent(topic: string, event: any): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [{
          key: event.sessionId,
          value: JSON.stringify(event),
        }],
      });
    } catch (err) {
      console.error(`[Kafka] Error sending event to ${topic}:`, err);
    }
  }
}
