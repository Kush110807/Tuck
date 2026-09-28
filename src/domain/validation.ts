import type {
  AppError,
  CreateItemInput,
  FieldKey,
  ImageSelection,
  ItemQuery,
  ItemType,
  UpdateItemInput,
} from '../contracts';
import { normalizeComparableText, normalizeTags, toComparisonKey, type NormalizedTag } from './normalization';

export const MAX_TITLE_CHARS = 120;
export const MAX_BODY_CHARS = 10_000;
export const MAX_URL_CHARS = 2_000;
export const MAX_TAGS = 8;
export const MAX_TAG_CHARS = 24;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ITEM_TYPES = new Set<ItemType>(['note', 'link', 'image']);
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ValidatedTags = Readonly<{
  display: readonly string[];
  records: readonly NormalizedTag[];
}>;

export type ValidatedCreateInput =
  | Readonly<{ type: 'note'; title: string; body: string; tags: ValidatedTags }>
  | Readonly<{ type: 'link'; title: string; url: string; tags: ValidatedTags }>
  | Readonly<{ type: 'image'; title: string; caption: string | null; image: ImageSelection; tags: ValidatedTags }>;

export type ValidatedUpdateInput =
  | Readonly<{ id: string; type: 'note'; expectedUpdatedAt: number; changes: Readonly<{ title?: string; body?: string; tags?: ValidatedTags }> }>
  | Readonly<{ id: string; type: 'link'; expectedUpdatedAt: number; changes: Readonly<{ title?: string; url?: string; tags?: ValidatedTags }> }>
  | Readonly<{ id: string; type: 'image'; expectedUpdatedAt: number; changes: Readonly<{ title?: string; caption?: string | null; image?: { kind: 'replace'; selection: ImageSelection }; tags?: ValidatedTags }> }>;

export type ValidatedQuery = Readonly<{
  archived: boolean;
  textKey: string;
  type: ItemType | 'all';
  tagKey: string | null;
}>;

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

function validationError(message: string, field?: FieldKey): AppError {
  return { code: 'VALIDATION', message, ...(field ? { field } : {}) };
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function validateTitle(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') return { ok: false, error: validationError('Title is required.', 'title') };
  const title = value.trim();
  if (!title) return { ok: false, error: validationError('Title is required.', 'title') };
  if (characterCount(title) > MAX_TITLE_CHARS) {
    return { ok: false, error: validationError(`Title must be ${MAX_TITLE_CHARS} characters or fewer.`, 'title') };
  }
  return { ok: true, value: title };
}

function validateBody(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, error: validationError('Note body is required.', 'body') };
  }
  const body = value.trim();
  if (!body) return { ok: false, error: validationError('Note body is required.', 'body') };
  if (characterCount(body) > MAX_BODY_CHARS) {
    return { ok: false, error: validationError(`Note body must be ${MAX_BODY_CHARS.toLocaleString()} characters or fewer.`, 'body') };
  }
  return { ok: true, value: body };
}

function validateCaption(value: unknown): ValidationResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: validationError('Caption must be text.', 'caption') };
  const caption = value.trim();
  if (!caption) return { ok: true, value: null };
  if (characterCount(caption) > MAX_BODY_CHARS) {
    return { ok: false, error: validationError(`Caption must be ${MAX_BODY_CHARS.toLocaleString()} characters or fewer.`, 'caption') };
  }
  return { ok: true, value: caption };
}

function validateUrl(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, error: validationError('URL is required.', 'url') };
  }
  const url = value.trim();
  if (!url) return { ok: false, error: validationError('URL is required.', 'url') };
  if (characterCount(url) > MAX_URL_CHARS) {
    return { ok: false, error: validationError(`URL must be ${MAX_URL_CHARS.toLocaleString()} characters or fewer.`, 'url') };
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: validationError('URL must start with http:// or https://.', 'url') };
    }
  } catch {
    return { ok: false, error: validationError('Enter a valid http:// or https:// URL.', 'url') };
  }

  return { ok: true, value: url };
}

function validateTags(value: unknown): ValidationResult<ValidatedTags> {
  if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string')) {
    return { ok: false, error: validationError('Tags must be text values.', 'tags') };
  }

  const records = normalizeTags(value as readonly string[]);
  for (const tag of records) {
    if (characterCount(tag.display) > MAX_TAG_CHARS) {
      return { ok: false, error: validationError(`Each tag must be ${MAX_TAG_CHARS} characters or fewer.`, 'tags') };
    }
  }
  if (records.length > MAX_TAGS) {
    return { ok: false, error: validationError(`Use at most ${MAX_TAGS} tags.`, 'tags') };
  }

  return { ok: true, value: { records, display: records.map(tag => tag.display) } };
}

export function validateImageSelectionShape(selection: unknown): ValidationResult<ImageSelection> {
  if (!selection || typeof selection !== 'object') {
    return { ok: false, error: { code: 'IMAGE_UNSUPPORTED', message: 'Select a JPEG, PNG, or WebP image.', field: 'image' } };
  }
  const candidate = selection as Partial<ImageSelection>;
  if (typeof candidate.temporaryUri !== 'string' || !candidate.temporaryUri) {
    return { ok: false, error: { code: 'IMAGE_UNSUPPORTED', message: 'Select a JPEG, PNG, or WebP image.', field: 'image' } };
  }
  if (candidate.mimeType !== undefined && candidate.mimeType !== null && !IMAGE_MIME_TYPES.has(candidate.mimeType)) {
    return { ok: false, error: { code: 'IMAGE_UNSUPPORTED', message: 'Select a JPEG, PNG, or WebP image.', field: 'image' } };
  }
  if (candidate.reportedBytes !== undefined && (!Number.isFinite(candidate.reportedBytes) || candidate.reportedBytes < 0)) {
    return { ok: false, error: validationError('Selected image size is invalid.', 'image') };
  }
  return { ok: true, value: candidate as ImageSelection };
}

export function validateCreateInput(input: CreateItemInput): ValidationResult<ValidatedCreateInput> {
  if (!input || typeof input !== 'object' || !ITEM_TYPES.has((input as CreateItemInput).type)) {
    return { ok: false, error: validationError('Unsupported item type.') };
  }

  const title = validateTitle(input.title);
  if (!title.ok) return title;
  const tags = validateTags(input.tags);
  if (!tags.ok) return tags;

  switch (input.type) {
    case 'note': {
      const body = validateBody(input.body);
      if (!body.ok) return body;
      return { ok: true, value: { type: 'note', title: title.value, body: body.value, tags: tags.value } };
    }
    case 'link': {
      const url = validateUrl(input.url);
      if (!url.ok) return url;
      return { ok: true, value: { type: 'link', title: title.value, url: url.value, tags: tags.value } };
    }
    case 'image': {
      const caption = validateCaption(input.caption);
      if (!caption.ok) return caption;
      const image = validateImageSelectionShape(input.image);
      if (!image.ok) return image;
      return { ok: true, value: { type: 'image', title: title.value, caption: caption.value, image: image.value, tags: tags.value } };
    }
  }
}

function validateIdentity(id: unknown, expectedUpdatedAt: unknown): ValidationResult<{ id: string; expectedUpdatedAt: number }> {
  if (typeof id !== 'string' || !id) return { ok: false, error: validationError('Item ID is required.') };
  if (typeof expectedUpdatedAt !== 'number' || !Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0) {
    return { ok: false, error: validationError('Expected update timestamp is invalid.') };
  }
  return { ok: true, value: { id, expectedUpdatedAt } };
}

export function validateUpdateInput(input: UpdateItemInput): ValidationResult<ValidatedUpdateInput> {
  if (!input || typeof input !== 'object' || !ITEM_TYPES.has((input as UpdateItemInput).type)) {
    return { ok: false, error: validationError('Unsupported item type.') };
  }
  const identity = validateIdentity(input.id, input.expectedUpdatedAt);
  if (!identity.ok) return identity;
  if (!input.changes || typeof input.changes !== 'object') {
    return { ok: false, error: validationError('Update changes are required.') };
  }

  const common: { title?: string; tags?: ValidatedTags } = {};
  if (input.changes.title !== undefined) {
    const title = validateTitle(input.changes.title);
    if (!title.ok) return title;
    common.title = title.value;
  }
  if (input.changes.tags !== undefined) {
    const tags = validateTags(input.changes.tags);
    if (!tags.ok) return tags;
    common.tags = tags.value;
  }

  switch (input.type) {
    case 'note': {
      const changes: { title?: string; body?: string; tags?: ValidatedTags } = { ...common };
      if (input.changes.body !== undefined) {
        const body = validateBody(input.changes.body);
        if (!body.ok) return body;
        changes.body = body.value;
      }
      return { ok: true, value: { ...identity.value, type: 'note', changes } };
    }
    case 'link': {
      const changes: { title?: string; url?: string; tags?: ValidatedTags } = { ...common };
      if (input.changes.url !== undefined) {
        const url = validateUrl(input.changes.url);
        if (!url.ok) return url;
        changes.url = url.value;
      }
      return { ok: true, value: { ...identity.value, type: 'link', changes } };
    }
    case 'image': {
      const changes: {
        title?: string;
        caption?: string | null;
        image?: { kind: 'replace'; selection: ImageSelection };
        tags?: ValidatedTags;
      } = { ...common };
      if (input.changes.caption !== undefined) {
        const caption = validateCaption(input.changes.caption);
        if (!caption.ok) return caption;
        changes.caption = caption.value;
      }
      if (input.changes.image !== undefined) {
        if (input.changes.image.kind !== 'replace') {
          return { ok: false, error: validationError('Image replacement is invalid.', 'image') };
        }
        const image = validateImageSelectionShape(input.changes.image.selection);
        if (!image.ok) return image;
        changes.image = { kind: 'replace', selection: image.value };
      }
      return { ok: true, value: { ...identity.value, type: 'image', changes } };
    }
  }
}

export function validateQuery(query: ItemQuery): ValidationResult<ValidatedQuery> {
  if (!query || typeof query !== 'object') return { ok: false, error: validationError('Query is invalid.') };
  if (typeof query.archived !== 'boolean') return { ok: false, error: validationError('Archive filter is invalid.') };
  if (query.type !== 'all' && !ITEM_TYPES.has(query.type)) return { ok: false, error: validationError('Type filter is invalid.') };
  if (typeof query.text !== 'string') return { ok: false, error: validationError('Search text is invalid.') };
  if (query.tagKey !== null && typeof query.tagKey !== 'string') return { ok: false, error: validationError('Tag filter is invalid.') };

  const tagKey = query.tagKey === null ? null : toComparisonKey(query.tagKey);
  return {
    ok: true,
    value: {
      archived: query.archived,
      type: query.type,
      textKey: toComparisonKey(query.text),
      tagKey: tagKey || null,
    },
  };
}

export function fieldContainsSearch(value: string | null, textKey: string): boolean {
  if (!textKey || value === null) return !textKey;
  return toComparisonKey(value).includes(textKey);
}

export function normalizeSearchField(value: string): string {
  return normalizeComparableText(value).toLowerCase();
}
