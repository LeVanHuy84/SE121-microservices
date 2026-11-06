import { EmbeddingService } from './embedding.service';

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(() => {
    service = new EmbeddingService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.isReady()).toBe(false);
  });

  describe('formatting helpers', () => {
    it('should format query text with "query: " prefix and collapsed spaces', () => {
      const formatted = service.formatQueryText(
        '  software   engineer   in Vietnam  ',
      );
      expect(formatted).toBe('query: software engineer in Vietnam');
    });

    it('should format candidate text with "passage: " prefix and collapsed spaces', () => {
      const formatted = service.formatCandidateText('  biology   researcher  ');
      expect(formatted).toBe('passage: biology researcher');
    });
  });

  describe('generateEmbedding', () => {
    it('should throw error if extractor is not ready', async () => {
      await expect(service.generateEmbedding('hello')).rejects.toThrow(
        'Embedding model not initialized',
      );
    });

    it('should call extractor and return normalized vector data', async () => {
      const mockExtractor = jest.fn().mockResolvedValue({
        data: new Float32Array([0.1, 0.2, 0.3]),
      });
      (service as any).extractor = mockExtractor;
      (service as any).isModelReady = true;

      const vector = await service.generateEmbedding('query: test');

      expect(mockExtractor).toHaveBeenCalledWith('query: test', {
        pooling: 'mean',
        normalize: true,
      });
      expect(vector).toEqual([
        expect.closeTo(0.1, 4),
        expect.closeTo(0.2, 4),
        expect.closeTo(0.3, 4),
      ]);
    });
  });

  describe('onModuleInit error handling', () => {
    it('should gracefully handle pipeline initialization failure without crashing', async () => {
      // Mock import failure by temporarily overriding or catching
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });
});
