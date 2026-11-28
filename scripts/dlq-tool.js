#!/usr/bin/env node
/**
 * Kafka Dead Letter Queue (DLQ) Inspection & Replay Tool
 *
 * Usage:
 *   node scripts/dlq-tool.js list <topic> [--limit 20]
 *   node scripts/dlq-tool.js replay <topic> [--limit 10]
 *
 * Env:
 *   KAFKA_BROKERS (default: localhost:9092)
 */
const { Kafka } = require("kafkajs");

async function main() {
  const [, , command, topic, ...rest] = process.argv;

  if (!command || !topic || !["list", "replay"].includes(command)) {
    console.error("Usage: node scripts/dlq-tool.js <list|replay> <topic> [--limit N]");
    process.exit(1);
  }

  const limitIdx = rest.indexOf("--limit");
  const limit = limitIdx >= 0 && rest[limitIdx + 1] ? parseInt(rest[limitIdx + 1], 10) : 20;
  const dlqTopic = topic.endsWith(".DLQ") ? topic : `${topic}.DLQ`;
  const brokers = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");

  const kafka = new Kafka({ clientId: "se121-dlq-tool", brokers });
  const admin = kafka.admin();
  await admin.connect();

  const existingTopics = await admin.listTopics();
  if (!existingTopics.includes(dlqTopic)) {
    console.log(`DLQ topic "${dlqTopic}" does not exist yet (0 failed messages).`);
    await admin.disconnect();
    return;
  }

  const offsets = await admin.fetchTopicOffsets(dlqTopic);
  const totalMessages = offsets.reduce(
    (sum, p) => sum + Math.max(0, Number(p.high) - Number(p.low)),
    0,
  );
  console.log(`DLQ Topic: ${dlqTopic} | Total buffered messages: ${totalMessages}`);
  await admin.disconnect();

  if (totalMessages === 0) {
    return;
  }

  const groupId =
    command === "replay" ? "se121-dlq-replay-group" : `se121-dlq-inspect-${Date.now()}`;
  const consumer = kafka.consumer({ groupId });
  const producer = command === "replay" ? kafka.producer() : null;

  await consumer.connect();
  if (producer) await producer.connect();

  await consumer.subscribe({ topic: dlqTopic, fromBeginning: true });

  let count = 0;
  let idleTimer;

  await new Promise((resolve) => {
    const finish = async () => {
      clearTimeout(idleTimer);
      await consumer.disconnect().catch(() => {});
      if (producer) await producer.disconnect().catch(() => {});
      resolve();
    };

    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, 2500);
    };
    resetIdle();

    consumer.run({
      autoCommit: command === "replay",
      eachMessage: async ({ partition, message }) => {
        if (count >= limit) {
          await finish();
          return;
        }
        resetIdle();
        count += 1;

        const raw = message.value ? message.value.toString("utf-8") : "{}";
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = { raw };
        }

        if (command === "list") {
          console.log(
            `[${count}] partition=${partition} offset=${message.offset} failedAt=${parsed.failedAt || "n/a"} error=${parsed.error?.message || "n/a"}`,
          );
        } else if (command === "replay" && producer) {
          const targetTopic = parsed.originalTopic || topic.replace(/\.DLQ$/, "");
          const payload = parsed.message !== undefined ? parsed.message : parsed;
          await producer.send({
            topic: targetTopic,
            messages: [
              {
                key: message.key,
                value: JSON.stringify(payload),
              },
            ],
          });
          console.log(
            `[REPLAYED ${count}] ${dlqTopic} (offset=${message.offset}) -> ${targetTopic}`,
          );
        }

        if (count >= limit) {
          await finish();
        }
      },
    });
  });

  console.log(`Done. Processed ${count} message(s).`);
}

main().catch((err) => {
  console.error("DLQ tool failed:", err);
  process.exit(1);
});
