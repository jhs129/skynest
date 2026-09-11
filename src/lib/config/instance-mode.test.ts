import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isPublicHomepageEnabled } from './instance-mode.js';

describe('isPublicHomepageEnabled', () => {
  const original = process.env.PUBLIC_HOMEPAGE;

  beforeEach(() => {
    delete process.env.PUBLIC_HOMEPAGE;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PUBLIC_HOMEPAGE;
    } else {
      process.env.PUBLIC_HOMEPAGE = original;
    }
  });

  it('defaults to enabled when PUBLIC_HOMEPAGE is unset', () => {
    expect(isPublicHomepageEnabled()).toBe(true);
  });

  it('is disabled when PUBLIC_HOMEPAGE=false', () => {
    process.env.PUBLIC_HOMEPAGE = 'false';
    expect(isPublicHomepageEnabled()).toBe(false);
  });

  it('is enabled for any other value', () => {
    process.env.PUBLIC_HOMEPAGE = 'true';
    expect(isPublicHomepageEnabled()).toBe(true);
  });
});
