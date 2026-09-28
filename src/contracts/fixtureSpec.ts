/** Fixed IDs and values for C's tests and the isolated master preview. Never seed production. */
export const fixtureSpec = {
  note: {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'note', title: 'Lecture thought', body: 'Revise the wave equation before Friday.',
    tags: ['Study'], createdAt: 1760000000000, updatedAt: 1760000001000, archived: false, collectionId: null, pinned: false,
  },
  link: {
    id: '00000000-0000-4000-8000-000000000002',
    type: 'link', title: 'Expo guide', url: 'https://docs.expo.dev/',
    tags: ['Reading', 'Build'], createdAt: 1760000002000, updatedAt: 1760000003000, archived: false, collectionId: null, pinned: false,
  },
  image: {
    id: '00000000-0000-4000-8000-000000000003',
    type: 'image', title: 'Colour study', body: 'Muted green and ivory.',
    imagePath: 'images/fixture-card.png', tags: ['Ideas'],
    createdAt: 1760000004000, updatedAt: 1760000005000, archived: false, collectionId: null, pinned: false,
  },
  archivedNote: {
    id: '00000000-0000-4000-8000-000000000004',
    type: 'note', title: 'Past reminder', body: 'An archived reference.',
    tags: ['Study'], createdAt: 1760000006000, updatedAt: 1760000007000, archived: true, collectionId: null, pinned: false,
  },
  bundledTestImage: 'assets/fixtures/fixture-card.png',
} as const;
