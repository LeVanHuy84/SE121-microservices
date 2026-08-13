// group.index.ts
export const GROUP_INDEX = 'groups';

export const GroupIndexMapping = {
  mappings: {
    properties: {
      id: {
        type: 'keyword',
      },
      name: {
        type: 'text',
        analyzer: 'standard',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 256,
          },
        },
      },
      description: {
        type: 'text',
        analyzer: 'standard',
      },
      avatarUrl: {
        type: 'keyword',
        index: false, // không search, chỉ trả về
      },
      privacy: {
        type: 'keyword',
      },
      members: {
        type: 'integer',
      },
      createdAt: {
        type: 'date',
      },
    },
  },
};
