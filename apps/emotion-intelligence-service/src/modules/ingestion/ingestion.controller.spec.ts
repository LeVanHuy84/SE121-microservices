import { Test, TestingModule } from '@nestjs/testing';
import { IngestionController } from './ingestion.controller';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('IngestionController', () => {
  let controller: IngestionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IngestionController],
    }).compile();

    controller = module.get<IngestionController>(IngestionController);
  });

  it('should be defined', () => {
    assert.ok(controller);
  });
});
