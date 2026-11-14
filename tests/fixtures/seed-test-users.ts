/**
 * seed-test-users.ts
 * Deterministic test fixtures for Phase 5 Inter-Service E2E & Chaos testing.
 */

export interface TestUser {
  id: string;
  clerkId: string;
  email: string;
  fullName: string;
  role: 'USER' | 'ADMIN';
  token: string;
}

export const TEST_USERS: Record<string, TestUser> = {
  onboarding: {
    id: 'user_onboarding_001',
    clerkId: 'user_2test_clerk_onboarding_001',
    email: 'minh.tran.test@example.com',
    fullName: 'Minh Tran',
    role: 'USER',
    token: 'mock_jwt_token_onboarding_001',
  },
  author: {
    id: 'user_author_002',
    clerkId: 'user_2test_clerk_author_002',
    email: 'author.feed@example.com',
    fullName: 'Hoang Author',
    role: 'USER',
    token: 'mock_jwt_token_author_002',
  },
  follower: {
    id: 'user_follower_003',
    clerkId: 'user_2test_clerk_follower_003',
    email: 'follower.feed@example.com',
    fullName: 'Linh Follower',
    role: 'USER',
    token: 'mock_jwt_token_follower_003',
  },
  crisisUser: {
    id: 'user_crisis_004',
    clerkId: 'user_2test_clerk_crisis_004',
    email: 'crisis.user@example.com',
    fullName: 'Nam Distress',
    role: 'USER',
    token: 'mock_jwt_token_crisis_004',
  },
  userA: {
    id: 'user_social_a_005',
    clerkId: 'user_2test_clerk_user_a_005',
    email: 'social.user.a@example.com',
    fullName: 'An Social',
    role: 'USER',
    token: 'mock_jwt_token_user_a_005',
  },
  userB: {
    id: 'user_social_b_006',
    clerkId: 'user_2test_clerk_user_b_006',
    email: 'social.user.b@example.com',
    fullName: 'Binh Social',
    role: 'USER',
    token: 'mock_jwt_token_user_b_006',
  },
  userC: {
    id: 'user_social_c_007',
    clerkId: 'user_2test_clerk_user_c_007',
    email: 'social.user.c@example.com',
    fullName: 'Cuong Viewer',
    role: 'USER',
    token: 'mock_jwt_token_user_c_007',
  },
  alice: {
    id: 'user_chat_alice_008',
    clerkId: 'user_2test_clerk_alice_008',
    email: 'alice.chat@example.com',
    fullName: 'Alice Vo',
    role: 'USER',
    token: 'mock_jwt_token_alice_008',
  },
  bob: {
    id: 'user_chat_bob_009',
    clerkId: 'user_2test_clerk_bob_009',
    email: 'bob.chat@example.com',
    fullName: 'Bob Dang',
    role: 'USER',
    token: 'mock_jwt_token_bob_009',
  },
  musicUser: {
    id: 'user_music_010',
    clerkId: 'user_2test_clerk_music_010',
    email: 'music.listener@example.com',
    fullName: 'Mai Melody',
    role: 'USER',
    token: 'mock_jwt_token_music_010',
  },
};
