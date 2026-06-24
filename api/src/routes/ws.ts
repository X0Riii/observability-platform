import { FastifyInstance } from 'fastify';
import { Kafka, Consumer } from 'kafkajs';

export function registerWebSocketRoutes(app: FastifyInstance, kafka: Kafka): void {
  app.get('/api/ws/stream/:sessionId', { websocket: true }, (socket, req) => {
    const { sessionId } = req.params as any;
    let consumer: Consumer | null = null;

    socket.on('message', async () => {
      if (consumer) return;

      consumer = kafka.consumer({ groupId: `rt-${sessionId}-${Date.now()}` });
      await consumer.connect();
      await consumer.subscribe({ topic: 'obs.timeline.merged' });

      consumer.run({
        eachMessage: async ({ message }) => {
          try {
            const event = JSON.parse(message.value!.toString());
            if (event.sessionId === sessionId && socket.readyState === 1) {
              socket.send(JSON.stringify(event));
            }
          } catch {}
        },
      });
    });

    socket.on('close', async () => {
      if (consumer) {
        await consumer.disconnect();
      }
    });
  });
}
