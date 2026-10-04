import { sanitizeSensitiveDataRecord } from './sensitive-data.js';

describe('sanitizeSensitiveDataRecord: password-typed profile payloads (NiceMatrix)', () => {
  it('masks `value` when the sibling `type` is password', () => {
    expect(
      sanitizeSensitiveDataRecord({ payload: { type: 'password', value: 'plain-text-Pa55!' } })
    ).toEqual({ payload: { type: 'password', value: '******' } });
  });

  it('masks regardless of value shape and type casing', () => {
    expect(sanitizeSensitiveDataRecord({ type: 'Password', value: { nested: 'x' } })).toEqual({
      type: 'Password',
      value: '******',
    });
  });

  it('keeps `value` for other profile types', () => {
    expect(sanitizeSensitiveDataRecord({ type: 'username', value: 'alice' })).toEqual({
      type: 'username',
      value: 'alice',
    });
    expect(
      sanitizeSensitiveDataRecord({ type: 'extraProfile', values: { nickname: 'Al' } })
    ).toEqual({ type: 'extraProfile', values: { nickname: 'Al' } });
  });

  it('keeps upstream key-based masking unchanged', () => {
    expect(
      sanitizeSensitiveDataRecord({ password: 'x', passwordVerified: true, client_secret: 's' })
    ).toEqual({ password: '******', passwordVerified: true, client_secret: '******' });
  });
});
