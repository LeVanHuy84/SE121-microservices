// search/post.mapping.ts

export const POST_INDEX = 'posts';

export const PostMapping = {
  mappings: {
    properties: {
      id: { type: 'keyword' },
      userId: { type: 'keyword' },
      groupId: { type: 'keyword' },

      content: {
        type: 'text',
        analyzer: 'standard',
        search_analyzer: 'standard',
      },

      mainEmotion: { type: 'keyword' },

      createdAt: { type: 'date' },
    },
  },
};
