import type {
  BaseUserDTO,
  ProfileRecommendationCandidateDTO,
  UserResponseDTO,
} from '@repo/dtos';
import type { GroupRecommendationCandidate } from '../src/client/group/group-client.service';
import type { FriendRecommendation } from '../src/friendship/repositories/social-graph.repository';

export class InMemoryRedis {
  private readonly storage = new Map<string, string>();

  async set(key: string, value: string): Promise<'OK'>;
  async set(
    key: string,
    value: string,
    _mode: 'EX',
    _seconds: number,
  ): Promise<'OK'>;
  async set(): Promise<'OK'> {
    const [key, value] = arguments as unknown as [string, string];
    this.storage.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }
}

interface MultiUserRecommendationFixture {
  viewerId: string;
  graphCandidates: FriendRecommendation[];
  groupCandidates: GroupRecommendationCandidate[];
  summarizedGroupCandidates: FriendRecommendation[];
  commonGroupCounts: Record<string, number>;
  commonGroupNames: Record<string, string[]>;
  aiScores: Record<string, number>;
  profileCandidates: ProfileRecommendationCandidateDTO[];
  fullUsers: Record<string, UserResponseDTO>;
  baseUsers: Record<string, BaseUserDTO>;
  expectedOrder: string[];
}

function createFullUser(
  id: string,
  overrides: Partial<UserResponseDTO> = {},
): UserResponseDTO {
  return {
    id,
    email: `${id}@example.com`,
    isActive: true,
    firstName: 'Test',
    lastName: id,
    avatarUrl: '',
    bio: '',
    location: '',
    jobTitle: '',
    company: '',
    school: '',
    interests: [],
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createBaseUser(
  id: string,
  firstName: string,
  lastName: string,
): BaseUserDTO {
  return {
    id,
    firstName,
    lastName,
    avatarUrl: '',
  };
}

export function buildMultiUserRecommendationFixture(): MultiUserRecommendationFixture {
  const viewerId = 'viewer';
  const fullUsers: Record<string, UserResponseDTO> = {
    viewer: createFullUser('viewer', {
      firstName: 'Vinh',
      lastName: 'Co',
      bio: 'Backend engineer building social products and developer tools',
      location: 'Ho Chi Minh City',
      jobTitle: 'Backend Engineer',
      company: 'Acme Social',
      school: 'HCMUT',
      interests: ['technology', 'running', 'community'],
    }),
    'semantic-peer': createFullUser('semantic-peer', {
      firstName: 'Minh',
      lastName: 'Le',
      bio: 'Platform engineer building social backend systems and APIs',
      location: 'Ho Chi Minh City',
      jobTitle: 'Platform Engineer',
      company: 'Social Hub',
      school: 'HCMUT',
      interests: ['technology', 'running'],
    }),
    'deep-graph': createFullUser('deep-graph', {
      firstName: 'Hoang',
      lastName: 'Tran',
      bio: 'Operations lead focused on outreach, sales, and partnerships',
      location: 'Da Nang',
      jobTitle: 'Operations Lead',
      company: 'Growth Works',
      school: 'DUT',
      interests: ['sales', 'operations'],
    }),
    'runner-a': createFullUser('runner-a', {
      firstName: 'An',
      lastName: 'Pham',
      bio: 'Backend engineer who runs and joins hackathons every month',
      location: 'Ho Chi Minh City',
      jobTitle: 'Backend Engineer',
      company: 'Runner Labs',
      school: 'HCMUT',
      interests: ['running', 'technology'],
    }),
    'runner-b': createFullUser('runner-b', {
      firstName: 'Bao',
      lastName: 'Nguyen',
      bio: 'Mobile engineer who runs every weekend with local communities',
      location: 'Ho Chi Minh City',
      jobTitle: 'Mobile Engineer',
      company: 'App Forge',
      school: 'UIT',
      interests: ['running', 'mobile'],
    }),
    'mutual-docs': createFullUser('mutual-docs', {
      firstName: 'Chi',
      lastName: 'Vu',
      bio: 'Technical writer documenting APIs and developer tools',
      location: 'Hue',
      jobTitle: 'Technical Writer',
      company: 'Docs Studio',
      school: 'Hue University',
      interests: ['writing', 'technology'],
    }),
    'mutual-local': createFullUser('mutual-local', {
      firstName: 'Dung',
      lastName: 'Vo',
      bio: 'Local organizer helping startup and student communities connect',
      location: 'Ho Chi Minh City',
      jobTitle: 'Community Organizer',
      company: 'City Network',
      school: 'UEH',
      interests: ['community', 'events'],
    }),
    'community-host': createFullUser('community-host', {
      firstName: 'Giang',
      lastName: 'Ngo',
      bio: 'Community host organizing meetups, volunteer days, and weekend runs',
      location: 'Ho Chi Minh City',
      jobTitle: 'Community Host',
      company: 'Community Hub',
      school: 'UEH',
      interests: ['community', 'running', 'volunteering'],
    }),
    'group-designer': createFullUser('group-designer', {
      firstName: 'Lan',
      lastName: 'Bui',
      bio: 'Product designer hosting maker events and design critiques',
      location: 'Da Nang',
      jobTitle: 'Product Designer',
      company: 'Design Guild',
      school: 'UEH',
      interests: ['design', 'community'],
    }),
  };

  const baseUsers: Record<string, BaseUserDTO> = {
    viewer: createBaseUser('viewer', 'Vinh', 'Co'),
    'semantic-peer': createBaseUser('semantic-peer', 'Minh', 'Le'),
    'deep-graph': createBaseUser('deep-graph', 'Hoang', 'Tran'),
    'runner-a': createBaseUser('runner-a', 'An', 'Pham'),
    'runner-b': createBaseUser('runner-b', 'Bao', 'Nguyen'),
    'mutual-docs': createBaseUser('mutual-docs', 'Chi', 'Vu'),
    'mutual-local': createBaseUser('mutual-local', 'Dung', 'Vo'),
    'community-host': createBaseUser('community-host', 'Giang', 'Ngo'),
    'group-designer': createBaseUser('group-designer', 'Lan', 'Bui'),
    u1: createBaseUser('u1', 'Quang', 'Le'),
    u2: createBaseUser('u2', 'Phuong', 'Tran'),
    u3: createBaseUser('u3', 'Nam', 'Nguyen'),
    u4: createBaseUser('u4', 'Hoa', 'Pham'),
    u5: createBaseUser('u5', 'Thao', 'Vu'),
    u6: createBaseUser('u6', 'Khanh', 'Do'),
    u7: createBaseUser('u7', 'Linh', 'Bui'),
    u8: createBaseUser('u8', 'Son', 'Ho'),
    u9: createBaseUser('u9', 'Mai', 'Dao'),
    u10: createBaseUser('u10', 'Yen', 'Ngo'),
  };

  return {
    viewerId,
    graphCandidates: [
      { id: 'semantic-peer', mutualFriends: 2, mutualFriendIds: ['u5', 'u6'] },
      { id: 'deep-graph', mutualFriends: 4, mutualFriendIds: ['u1', 'u2', 'u3', 'u4'] },
      { id: 'runner-a', mutualFriends: 1, mutualFriendIds: ['u7'] },
      { id: 'runner-b', mutualFriends: 1, mutualFriendIds: ['u7'] },
      { id: 'mutual-docs', mutualFriends: 2, mutualFriendIds: ['u8', 'u9'] },
      { id: 'mutual-local', mutualFriends: 1, mutualFriendIds: ['u10'] },
    ],
    groupCandidates: [
      { id: 'community-host', commonGroups: 3 },
      { id: 'group-designer', commonGroups: 2 },
    ],
    summarizedGroupCandidates: [
      { id: 'community-host', mutualFriends: 0, mutualFriendIds: [] },
      { id: 'group-designer', mutualFriends: 0, mutualFriendIds: [] },
    ],
    commonGroupCounts: {
      'semantic-peer': 1,
      'deep-graph': 0,
      'runner-a': 1,
      'runner-b': 1,
      'mutual-docs': 0,
      'mutual-local': 0,
      'community-host': 3,
      'group-designer': 2,
    },
    commonGroupNames: {
      'semantic-peer': ['Platform Guild'],
      'deep-graph': [],
      'runner-a': ['Weekend Runners'],
      'runner-b': ['Weekend Runners'],
      'mutual-docs': [],
      'mutual-local': [],
      'community-host': ['Community Builders', 'Weekend Runners', 'Startup Friends'],
      'group-designer': ['Design Circle', 'Product Guild'],
    },
    aiScores: {
      'semantic-peer': 0.9,
      'deep-graph': 0,
      'runner-a': 0.4,
      'runner-b': 0.35,
      'mutual-docs': 0.1,
      'mutual-local': 0.15,
      'community-host': 0.7,
      'group-designer': 0.45,
    },
    profileCandidates: [
      {
        id: 'semantic-peer',
        profileMatchScore: 0.7,
        matchedSignals: ['location', 'school', 'interests:2'],
        sharedInterestsCount: 2,
      },
      {
        id: 'runner-a',
        profileMatchScore: 0.6,
        matchedSignals: ['location', 'jobTitle', 'school', 'interests:2'],
        sharedInterestsCount: 2,
      },
      {
        id: 'runner-b',
        profileMatchScore: 0.3,
        matchedSignals: ['location', 'interests:1'],
        sharedInterestsCount: 1,
      },
      {
        id: 'community-host',
        profileMatchScore: 0.4,
        matchedSignals: ['location', 'interests:1'],
        sharedInterestsCount: 1,
      },
      {
        id: 'mutual-local',
        profileMatchScore: 0.3,
        matchedSignals: ['location', 'interests:1'],
        sharedInterestsCount: 1,
      },
    ],
    fullUsers,
    baseUsers,
    expectedOrder: [
      'semantic-peer',
      'community-host',
      'runner-a',
      'deep-graph',
      'runner-b',
      'group-designer',
      'mutual-docs',
      'mutual-local',
    ],
  };
}

export function resolveFixtureUsers(
  users: Record<string, BaseUserDTO | UserResponseDTO>,
  ids: string[],
): Record<string, BaseUserDTO | UserResponseDTO> {
  return Object.fromEntries(
    ids
      .filter((id) => Boolean(users[id]))
      .map((id) => [id, users[id]]),
  );
}
