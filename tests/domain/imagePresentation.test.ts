import { describe, expect, it } from 'vitest';
import { getImagePresentation } from '../../src/ui/components/imagePresentation';

describe('stored image render recovery presentation', () => {
  it('switches a stored available image to a non-looping fallback after native render failure', () => {
    const image = { kind: 'available', uri: 'file:///images/stored.png' } as const;
    expect(getImagePresentation(image, false)).toEqual({ kind: 'image', uri: image.uri });
    expect(getImagePresentation(image, true)).toMatchObject({
      kind: 'fallback',
      reason: 'render-failed',
      title: 'Image cannot be displayed',
    });
  });

  it('keeps ordinary missing and image-resolution errors distinct', () => {
    expect(getImagePresentation({ kind: 'missing' }, false)).toMatchObject({ reason: 'missing' });
    expect(getImagePresentation({
      kind: 'unavailable',
      error: { code: 'OPEN_FAILED', message: 'Storage unavailable.', field: 'image' },
    }, false)).toMatchObject({ reason: 'unavailable', title: 'Image unavailable' });
  });
});
