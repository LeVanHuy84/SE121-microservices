import 'reflect-metadata';

import { RecommendationProfileEventType } from '@repo/dtos';
import { RecommendationEventController } from './recommendation-event.controller';

describe('RecommendationEventController', () => {
  it('should apply completed embedding results to user service', async () => {
    const userService = {
      applyRecommendationProfileEmbedding: jest.fn().mockResolvedValue(true),
    };
    const controller = new RecommendationEventController(
      userService as never,
    );

    await controller.handleRecommendationProfileEvents({
      type: RecommendationProfileEventType.EMBEDDING_COMPLETED,
      payload: {
        userId: 'user-1',
        semanticProfileText: 'name: An',
        requestId: 'req-1',
        schemaVersion: 1,
        modelName: 'demo-model',
        embedding: [0.1, 0.2],
        dimensions: 2,
        generatedAt: new Date().toISOString(),
      },
    });

    expect(userService.applyRecommendationProfileEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        requestId: 'req-1',
      }),
    );
  });
});
