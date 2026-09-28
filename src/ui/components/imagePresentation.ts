import type { ImageViewState } from '../../contracts';

export type ImagePresentation =
  | { kind: 'image'; uri: string }
  | { kind: 'fallback'; reason: 'none' | 'missing' | 'unavailable' | 'render-failed'; title: string; message: string };

/** Pure presentation rule used by native Image onError fallbacks and controller image states. */
export function getImagePresentation(image: ImageViewState, renderFailed: boolean): ImagePresentation {
  if (image.kind === 'available' && !renderFailed) return { kind: 'image', uri: image.uri };
  if (image.kind === 'available') {
    return {
      kind: 'fallback',
      reason: 'render-failed',
      title: 'Image cannot be displayed',
      message: 'The image renderer could not decode this file. The saved item details are unchanged.',
    };
  }
  if (image.kind === 'missing') {
    return {
      kind: 'fallback',
      reason: 'missing',
      title: 'Image file missing',
      message: 'The saved image cannot be found. The saved item details are unchanged.',
    };
  }
  if (image.kind === 'unavailable') {
    return {
      kind: 'fallback',
      reason: 'unavailable',
      title: 'Image unavailable',
      message: `${image.error.message} The saved item details are unchanged.`,
    };
  }
  return {
    kind: 'fallback',
    reason: 'none',
    title: 'No image selected',
    message: 'Choose a JPEG, PNG or WebP image.',
  };
}
