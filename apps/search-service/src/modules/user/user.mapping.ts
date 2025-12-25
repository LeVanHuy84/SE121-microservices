export const USER_INDEX = 'users';

export const UserIndexMapping = {
  mappings: {
    dynamic: false,

    properties: {
      id: { type: 'keyword' },

      email: {
        type: 'keyword',
      },

      firstName: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword', ignore_above: 256 },
        },
      },

      lastName: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword', ignore_above: 256 },
        },
      },

      avatarUrl: {
        type: 'keyword',
        index: false,
        null_value: null,
      },

      bio: { type: 'text' },

      createdAt: { type: 'date' },

      fullName: {
        type: 'text',
        analyzer: 'standard',
        fields: {
          keyword: { type: 'keyword', ignore_above: 256 },
        },
      },
    },
  },
} as const;
