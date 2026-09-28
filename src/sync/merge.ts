import { normalizeTags, toComparisonKey } from '../domain';
import type {
  CanonicalItem,
  CollectionPatchMutation,
  ItemMutableValues,
  ItemPatchMutation,
  ItemSyncField,
} from './protocol';
import { canonicalMutableItemValues } from './protocol';

type MutableItemValues = { -readonly [K in keyof ItemMutableValues]: ItemMutableValues[K] };

export type ItemMergeResult =
  | Readonly<{ kind: 'apply'; values: ItemMutableValues; changed: boolean; conflictFields: readonly [] }>
  | Readonly<{ kind: 'conflict'; conflictFields: readonly ItemSyncField[] }>;

export type CollectionMergeResult =
  | Readonly<{ kind: 'apply'; name: string; updatedAt: number; changed: boolean }>
  | Readonly<{ kind: 'conflict'; conflictFields: readonly ['name'] }>;

const AUTHORED_FIELDS = new Set<ItemSyncField>(['title', 'body', 'url', 'assetId']);
const METADATA_SERVER_ORDER_FIELDS = new Set<ItemSyncField>(['collectionId', 'pinned', 'archived']);

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function equalValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

/**
 * Three-way tag merge. A removal by either side wins for a tag that existed in
 * the base; concurrent additions are unioned. Current-server display spelling
 * and order win first, then genuinely new local additions are appended.
 */
export function mergeTagsThreeWay(
  baseTags: readonly string[],
  currentTags: readonly string[],
  localTags: readonly string[],
): readonly string[] {
  const base = normalizeTags(baseTags);
  const current = normalizeTags(currentTags);
  const local = normalizeTags(localTags);

  const baseKeys = new Set(base.map(tag => tag.key));
  const currentKeys = new Set(current.map(tag => tag.key));
  const localKeys = new Set(local.map(tag => tag.key));

  const removedByCurrent = new Set([...baseKeys].filter(key => !currentKeys.has(key)));
  const removedByLocal = new Set([...baseKeys].filter(key => !localKeys.has(key)));
  const removedByEither = new Set([...removedByCurrent, ...removedByLocal]);

  const merged = new Map<string, string>();
  for (const tag of current) {
    if (!removedByEither.has(tag.key)) merged.set(tag.key, tag.display);
  }
  for (const tag of local) {
    if (removedByEither.has(tag.key)) continue;
    if (!merged.has(tag.key)) merged.set(tag.key, tag.display);
  }

  return [...merged.values()];
}

export function mergeItemPatch(current: CanonicalItem, mutation: ItemPatchMutation): ItemMergeResult {
  const values: MutableItemValues = { ...canonicalMutableItemValues(current), tags: [...current.tags] };
  const conflicts: ItemSyncField[] = [];
  let semanticChange = false;
  let requestedUpdatedAt: number | undefined;

  for (const field of mutation.changedFields) {
    if (field === 'updatedAt') {
      if (!hasOwn(mutation.newValues, field) || typeof mutation.newValues.updatedAt !== 'number') {
        conflicts.push(field);
      } else {
        requestedUpdatedAt = mutation.newValues.updatedAt;
      }
      continue;
    }

    if (!hasOwn(mutation.baseValues, field) || !hasOwn(mutation.newValues, field)) {
      conflicts.push(field);
      continue;
    }

    const currentValue = values[field];
    const baseValue = mutation.baseValues[field];
    const newValue = mutation.newValues[field];

    if (equalValue(currentValue, newValue)) continue;

    if (field === 'tags') {
      if (!Array.isArray(baseValue) || !Array.isArray(newValue)) {
        conflicts.push(field);
        continue;
      }
      if (equalValue(currentValue, baseValue)) {
        values.tags = [...newValue] as readonly string[];
      } else {
        values.tags = mergeTagsThreeWay(
          baseValue as readonly string[],
          currentValue as readonly string[],
          newValue as readonly string[],
        );
      }
      if (!equalValue(values.tags, current.tags)) semanticChange = true;
      continue;
    }

    if (AUTHORED_FIELDS.has(field)) {
      if (!equalValue(currentValue, baseValue)) {
        conflicts.push(field);
        continue;
      }
      (values as unknown as Record<string, unknown>)[field] = newValue;
      semanticChange = true;
      continue;
    }

    if (METADATA_SERVER_ORDER_FIELDS.has(field)) {
      (values as unknown as Record<string, unknown>)[field] = newValue;
      semanticChange = true;
      continue;
    }

    conflicts.push(field);
  }

  if (conflicts.length > 0) return { kind: 'conflict', conflictFields: conflicts };

  // updatedAt is domain metadata only. It follows an accepted semantic mutation
  // but never participates in concurrency or causes a change by itself.
  if (semanticChange && requestedUpdatedAt !== undefined) values.updatedAt = requestedUpdatedAt;

  return { kind: 'apply', values, changed: semanticChange, conflictFields: [] };
}

export function mergeCollectionPatch(
  current: Readonly<{ name: string; updatedAt: number }>,
  mutation: CollectionPatchMutation,
): CollectionMergeResult {
  const wantsName = mutation.changedFields.includes('name');
  const wantsUpdatedAt = mutation.changedFields.includes('updatedAt');
  const nextName = wantsName ? mutation.newValues.name : current.name;

  if (wantsName) {
    if (typeof mutation.baseValues.name !== 'string' || typeof nextName !== 'string') {
      return { kind: 'conflict', conflictFields: ['name'] };
    }
    if (current.name !== mutation.baseValues.name && current.name !== nextName) {
      return { kind: 'conflict', conflictFields: ['name'] };
    }
  }

  const changed = typeof nextName === 'string' && nextName !== current.name;
  const nextUpdatedAt = changed && wantsUpdatedAt && typeof mutation.newValues.updatedAt === 'number'
    ? mutation.newValues.updatedAt
    : current.updatedAt;
  return { kind: 'apply', name: nextName ?? current.name, updatedAt: nextUpdatedAt, changed };
}

export function buildConflictCopyTitle(title: string, maxCodePoints = 120): string {
  const suffix = ' (conflict copy)';
  const suffixLength = [...suffix].length;
  const room = Math.max(0, maxCodePoints - suffixLength);
  const base = [...title].slice(0, room).join('').trimEnd();
  return `${base}${suffix}`;
}

export type LocalConflictCopyInput = Readonly<{
  localItem: Omit<CanonicalItem, 'version'>;
  originalItemId: string;
  newItemId: string;
  validCollectionIds: ReadonlySet<string>;
}>;

/**
 * Creates the local desired copy after an authored-content conflict. The copy
 * is an ordinary new Item and must itself be recorded in the durable outbox.
 */
export function makeConflictCopy(input: LocalConflictCopyInput): Omit<CanonicalItem, 'version'> {
  return {
    ...input.localItem,
    id: input.newItemId,
    title: buildConflictCopyTitle(input.localItem.title),
    tags: [...input.localItem.tags],
    collectionId: input.localItem.collectionId && input.validCollectionIds.has(input.localItem.collectionId)
      ? input.localItem.collectionId
      : null,
  };
}

export function collectionNameKey(name: string): string {
  return toComparisonKey(name);
}
