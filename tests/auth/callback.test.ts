import { describe, expect, it } from 'vitest';
import { parseMagicLinkCallback } from '../../src/auth/callback';

describe('Phase 6D magic-link callback parser',()=>{
  it('reads the bodyless GoTrue redirect tokens from the hash',()=>{expect(parseMagicLinkCallback('tuck://auth/callback#access_token=a&refresh_token=r&expires_in=3600')).toEqual({accessToken:'a',refreshToken:'r',expiresIn:3600});});
  it('rejects incomplete callbacks',()=>{expect(parseMagicLinkCallback('tuck://auth/callback#access_token=a')).toBeNull();});
});
