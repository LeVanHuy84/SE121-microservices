import { Test, TestingModule } from '@nestjs/testing';
import { CatalogService } from './catalog.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MusicFeature } from '../entities/music-feature.entity';
import { RpcException } from '@nestjs/microservices';
import { InternalMusicQueryDto, MusicGenre } from '@repo/dtos';

describe('CatalogService', () => {
  let service: CatalogService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    delete: jest.Mock;
    findAndCount: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  let mockQueryBuilder: {
    select: jest.Mock;
    take: jest.Mock;
    skip: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    setParameters: jest.Mock;
    getManyAndCount: jest.Mock;
  };

  beforeEach(async () => {
    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    repo = {
      create: jest.fn().mockImplementation((d) => ({ id: 'track-1', ...d })),
      save: jest
        .fn()
        .mockImplementation((d) => Promise.resolve({ id: 'track-1', ...d })),
      findOneBy: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        {
          provide: getRepositoryToken(MusicFeature),
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createMusicFeature', () => {
    it('should save and return new music feature', async () => {
      const dto: any = {
        title: 'Calm River',
        artist: 'Relaxing Vibes',
        valence: 0.7,
        arousal: 0.3,
        genre: 'Ambient',
      };

      const result = await service.createMusicFeature(dto);

      expect(repo.create).toHaveBeenCalledWith(dto);
      expect(repo.save).toHaveBeenCalled();
      expect(result.id).toBe('track-1');
      expect(result.title).toBe('Calm River');
    });
  });

  describe('getMusicFeature, updateMusicFeature, deleteMusicFeature 404 checks', () => {
    it('should throw RpcException with "Music track not found" on getMusicFeature 404', async () => {
      repo.findOneBy.mockResolvedValueOnce(null);

      await expect(service.getMusicFeature('non-existent')).rejects.toThrow(
        RpcException,
      );
      try {
        await service.getMusicFeature('non-existent');
      } catch (err: any) {
        expect(err.getError()).toEqual({
          statusCode: 404,
          message: 'Music track not found',
        });
      }
    });

    it('should throw RpcException with "Music track not found" on updateMusicFeature 404', async () => {
      repo.findOneBy.mockResolvedValueOnce(null);

      await expect(
        service.updateMusicFeature('non-existent', {}),
      ).rejects.toThrow(RpcException);
      try {
        await service.updateMusicFeature('non-existent', {});
      } catch (err: any) {
        expect(err.getError()).toEqual({
          statusCode: 404,
          message: 'Music track not found',
        });
      }
    });

    it('should throw RpcException with "Music track not found" on deleteMusicFeature 404', async () => {
      repo.findOneBy.mockResolvedValueOnce(null);

      await expect(service.deleteMusicFeature('non-existent')).rejects.toThrow(
        RpcException,
      );
      try {
        await service.deleteMusicFeature('non-existent');
      } catch (err: any) {
        expect(err.getError()).toEqual({
          statusCode: 404,
          message: 'Music track not found',
        });
      }
    });

    it('should update and return feature when found', async () => {
      const existing = { id: 'track-1', title: 'Old Title', valence: 0.5 };
      repo.findOneBy.mockResolvedValueOnce(existing);

      const result = await service.updateMusicFeature('track-1', {
        title: 'New Title',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Title' }),
      );
      expect(result.title).toBe('New Title');
    });

    it('should delete feature when found', async () => {
      repo.findOneBy.mockResolvedValueOnce({ id: 'track-1' });

      const result = await service.deleteMusicFeature('track-1');

      expect(repo.delete).toHaveBeenCalledWith({ id: 'track-1' });
      expect(result).toBe(true);
    });
  });

  describe('getMusicFeatures', () => {
    it('should query features with search term and genre filter', async () => {
      repo.findAndCount.mockResolvedValueOnce([
        [
          {
            id: 't1',
            title: 'Song 1',
            artist: 'Artist 1',
            valence: 0.5,
            arousal: 0.5,
          },
        ],
        1,
      ]);

      const res = await service.getMusicFeatures({
        search: 'Song',
        genre: MusicGenre.POP,
        page: 1,
        limit: 10,
      });

      expect(repo.findAndCount).toHaveBeenCalled();
      expect(res.data).toHaveLength(1);
      expect(res.total).toBe(1);
    });
  });

  describe('TC-MUS-03: queryForRecommendation with Valence/Arousal Ranges & Distance Ordering', () => {
    it('should apply valenceMin/Max, arousalMin/Max filters and Euclidean distance ordering', async () => {
      const mockTrack = {
        id: 'track-rec-1',
        title: 'Meditation',
        artist: 'Peace',
        valence: 0.65,
        arousal: 0.35,
        genre: 'Meditation',
        audio: 'audio.mp3',
        coverImage: 'img.png',
        createdAt: new Date(),
      };
      mockQueryBuilder.getManyAndCount.mockResolvedValueOnce([[mockTrack], 1]);

      const queryDto: InternalMusicQueryDto = {
        valenceMin: 0.5,
        valenceMax: 0.8,
        arousalMin: 0.2,
        arousalMax: 0.5,
        limit: 20,
        offset: 0,
        sortByDistanceTo: {
          valence: 0.6,
          arousal: 0.3,
          weightValence: 0.6,
          weightArousal: 0.4,
        },
      };

      const [tracks, total] = await service.queryForRecommendation(queryDto);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'musicFeature.valence >= :valenceMin',
        { valenceMin: 0.5 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'musicFeature.valence <= :valenceMax',
        { valenceMax: 0.8 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'musicFeature.arousal >= :arousalMin',
        { arousalMin: 0.2 },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'musicFeature.arousal <= :arousalMax',
        { arousalMax: 0.5 },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        expect.stringContaining('POWER(musicFeature.valence - :v, 2)'),
        'ASC',
      );
      expect(mockQueryBuilder.setParameters).toHaveBeenCalledWith({
        v: 0.6,
        a: 0.3,
      });
      expect(tracks).toHaveLength(1);
      expect(total).toBe(1);
      expect(tracks[0].id).toBe('track-rec-1');
    });
  });
});
