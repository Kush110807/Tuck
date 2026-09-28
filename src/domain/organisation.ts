import type { ItemQuery, SmartView, SmartViewQuery, SortOrder } from '../contracts';

export function createDefaultItemQuery(archived = false, sort: SortOrder = 'updated_desc'): ItemQuery {
  return {
    archived,
    text: '',
    type: 'all',
    tagKey: null,
    collectionId: null,
    pinned: null,
    hasTags: null,
    hasCollection: null,
    sort,
  };
}

/** Locked Phase 5B smart-view semantics. Smart Views are query presets only. */
export function createSmartViewQuery(view: SmartView, sort: SortOrder = 'updated_desc'): SmartViewQuery {
  const query = createDefaultItemQuery(false, sort);
  switch (view) {
    case 'pinned':
      query.pinned = true;
      break;
    case 'untagged':
      query.hasTags = false;
      break;
    case 'unfiled':
      query.hasCollection = false;
      break;
  }
  return { view, query };
}
