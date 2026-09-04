import { describe, expect, it } from 'vitest';
import { artworkThumb } from '@/utils/artwork';

describe('artworkThumb', () => {
  it('rewrites amplyart URLs to the requested thumbnail size', () => {
    expect(artworkThumb('http://amplyart.localhost/abc123.jpg', 64)).toBe('http://amplyart.localhost/abc123.64.jpg');
    expect(artworkThumb('http://amplyart.localhost/abc123.jpg', 128)).toBe('http://amplyart.localhost/abc123.128.jpg');
  });

  it('leaves already-thumbnailed amplyart URLs alone', () => {
    expect(artworkThumb('http://amplyart.localhost/abc123.64.jpg', 128)).toBe('http://amplyart.localhost/abc123.64.jpg');
  });

  it('returns non-amplyart sources unchanged', () => {
    expect(artworkThumb('data:image/jpeg;base64,abc', 64)).toBe('data:image/jpeg;base64,abc');
    expect(artworkThumb('https://example.com/cover.jpg', 128)).toBe('https://example.com/cover.jpg');
    expect(artworkThumb('http://amplyart.localhost/abc123.png', 64)).toBe('http://amplyart.localhost/abc123.png');
  });

  it('passes through undefined and empty values', () => {
    expect(artworkThumb(undefined, 64)).toBeUndefined();
    expect(artworkThumb('', 128)).toBe('');
  });
});
