import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private extractor: any;
  private isModelReady = false;

  async onModuleInit() {
    if (
      process.env.ENABLE_LOAD_TEST_MODE === 'true' ||
      process.env.MOCK_EXTERNAL_MODELS === 'true'
    ) {
      this.logger.log(
        'Load test / mock mode enabled: Skipping heavy HuggingFace model download.',
      );
      this.isModelReady = true;
      this.extractor = async () => ({
        data: new Float32Array(768).fill(0.01),
      });
      return;
    }

    const modelName =
      process.env.RECOMMENDATION_MODEL_NAME || 'Xenova/multilingual-e5-base';
    const dtype = process.env.RECOMMENDATION_MODEL_DTYPE || 'q8';

    this.logger.log(
      `Loading HuggingFace pipeline for model: "${modelName}" (dtype: ${dtype})...`,
    );
    try {
      // Dynamic import to prevent any compilation or startup lockups
      const hf = (await import('@huggingface/transformers')) as any;
      const pipeline = hf.pipeline;
      const env = hf.env;

      // 1. Fix EACCES error in Docker containers: redirect cacheDir to writable /tmp/.cache
      env.cacheDir =
        process.env.HF_CACHE_DIR || path.join(os.tmpdir(), '.cache');
      // Disable browser cache mechanism in Node environment to prevent EACCES warnings
      env.useBrowserCache = false;
      // Allow local file paths if user points RECOMMENDATION_MODEL_NAME to a local folder
      env.allowLocalModels = true;

      // 2. Load model from RECOMMENDATION_MODEL_NAME with INT8 quantization (dtype: 'q8') to save RAM & CPU
      this.extractor = await pipeline('feature-extraction', modelName, {
        dtype: dtype as any,
        device: 'cpu',
      });
      this.isModelReady = true;
      this.logger.log(
        `HuggingFace embedding pipeline loaded successfully for "${modelName}" (dtype: ${dtype}).`,
      );
    } catch (err) {
      this.logger.error('Failed to load HuggingFace embedding pipeline', err);
    }
  }

  isReady(): boolean {
    return this.isModelReady;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    let attempts = 0;
    const maxAttempts = process.env.NODE_ENV === 'test' ? 1 : 60;
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
