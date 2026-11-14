import { EventTopic } from './event-topic.enum';
import { EventTopic as SocialEventTopic } from '../../social/events/event.enum';

describe('EventTopic Enum (TC-DTO-01)', () => {
  it('TC-DTO-01: should have non-empty, unique topic string values', () => {
    const topicValues = Object.values(EventTopic);

    // Verify there are topics defined
    expect(topicValues.length).toBeGreaterThan(0);

    // Verify each topic value is a valid non-empty string
    for (const topic of topicValues) {
      expect(typeof topic).toBe('string');
      expect(topic.trim().length).toBeGreaterThan(0);
      // Valid topic naming conventions: kebab-case or dot-separated
      expect(topic).toMatch(/^[a-z0-9]+([.-][a-z0-9]+)*$/);
    }

    // Verify all topic string values are unique (no accidental duplicate topic names)
    const uniqueTopics = new Set(topicValues);
    expect(uniqueTopics.size).toBe(topicValues.length);
  });

  it('should contain all required event topics across domains', () => {
    const expectedTopics = [
      'chat-events',
      'post-events',
      'share-events',
      'interaction',
      'stats-events',
      'group-events',
      'group-crud-events',
      'user-events',
      'analysis-events',
      'analysis-result-events',
      'logging-events',
      'media-events',
      'recommendation-profile-events',
      'recommendation-graph-events',
      'recommendation-result-events',
      'test-fault',
      'user-activity-log-events',
      'chatbot.crisis.alert',
    ];

    for (const expected of expectedTopics) {
      expect(Object.values(EventTopic)).toContain(expected);
    }
  });

  it('should maintain backwards compatibility with social/events export', () => {
    expect(SocialEventTopic).toBe(EventTopic);
    expect(SocialEventTopic.POST).toBe('post-events');
    expect(SocialEventTopic.CHAT).toBe('chat-events');
  });
});

