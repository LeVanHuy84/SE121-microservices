import { Injectable, OnModuleInit, Logger } from '@nestjs/common';

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private extractor: any;
  private isModelReady = false;

  async onModuleInit() {
    this.logger.log(
      'Loading HuggingFace pipeline for Xenova/multilingual-e5-base...',
    );
    try {
      // Dynamic import to prevent any compilation or startup lockups
      const { pipeline } = await import('@huggingface/transformers');
      this.extractor = await pipeline(
        'feature-extraction',
        'Xenova/multilingual-e5-base',
        {
          quantized: true,
        },
      );
      this.isModelReady = true;
      this.logger.log('HuggingFace embedding pipeline loaded successfully.');
    } catch (err) {
      this.logger.error('Failed to load HuggingFace embedding pipeline', err);
    }
  }

  isReady(): boolean {
    return this.isModelReady;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds
    while (!this.isModelReady || !this.extractor) {
      if (attempts >= maxAttempts) {
        throw new Error('Embedding model not initialized after 30 seconds');
      }
      this.logger.log(
        `Embedding model is still loading, waiting 500ms (attempt ${attempts + 1}/${maxAttempts})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      attempts++;
    }
    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data);
  }

  formatQueryText(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return `query: ${clean}`;
  }

  formatCandidateText(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return `passage: ${clean}`;
  }
}
