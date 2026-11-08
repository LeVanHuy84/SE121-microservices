import { Test, TestingModule } from '@nestjs/testing';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

describe('CatalogController', () => {
  let controller: CatalogController;
  let catalogService: {
    createMusicFeature: jest.Mock;
    updateMusicFeature: jest.Mock;
    deleteMusicFeature: jest.Mock;
    getMusicFeature: jest.Mock;
    getMusicFeatures: jest.Mock;
  };

  beforeEach(async () => {
    catalogService = {
      createMusicFeature: jest.fn().mockResolvedValue({ id: 'm1' }),
      updateMusicFeature: jest.fn().mockResolvedValue({ id: 'm1' }),
      deleteMusicFeature: jest.fn().mockResolvedValue(true),
      getMusicFeature: jest.fn().mockResolvedValue({ id: 'm1' }),
      getMusicFeatures: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: catalogService }],
    }).compile();

    controller = module.get<CatalogController>(CatalogController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate createMusicFeature', async () => {
    const dto: any = { title: 'Track 1' };
    const res = await controller.createMusicFeature(dto);
    expect(catalogService.createMusicFeature).toHaveBeenCalledWith(dto);
    expect(res).toEqual({ id: 'm1' });
  });

  it('should delegate updateMusicFeature', async () => {
    const payload = { id: 'm1', dto: { title: 'Updated' } };
    const res = await controller.updateMusicFeature(payload);
    expect(catalogService.updateMusicFeature).toHaveBeenCalledWith(
      'm1',
      payload.dto,
    );
    expect(res).toEqual({ id: 'm1' });
  });

  it('should delegate deleteMusicFeature', async () => {
    const res = await controller.deleteMusicFeature('m1');
    expect(catalogService.deleteMusicFeature).toHaveBeenCalledWith('m1');
    expect(res).toBe(true);
  });

  it('should delegate getMusicFeature', async () => {
    const res = await controller.getMusicFeature('m1');
    expect(catalogService.getMusicFeature).toHaveBeenCalledWith('m1');
    expect(res).toEqual({ id: 'm1' });
  });

  it('should delegate listMusicFeatures', async () => {
    const query: any = { page: 1, limit: 10 };
    const res = await controller.listMusicFeatures(query);
    expect(catalogService.getMusicFeatures).toHaveBeenCalledWith(query);
    expect(res).toEqual({ data: [], total: 0 });
  });
});
