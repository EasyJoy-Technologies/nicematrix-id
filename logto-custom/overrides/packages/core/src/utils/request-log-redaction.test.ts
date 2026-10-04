import { redactRequestLogLine, redactRequestUrl } from './request-log-redaction.js';

describe('redactRequestUrl', () => {
  it('keeps URLs without a query string or without sensitive parameters unchanged', () => {
    expect(redactRequestUrl('/oidc/.well-known/openid-configuration')).toBe(
      '/oidc/.well-known/openid-configuration'
    );
    expect(redactRequestUrl('/sign-in?app_id=abc&ui_locales=zh-CN')).toBe(
      '/sign-in?app_id=abc&ui_locales=zh-CN'
    );
  });

  it('redacts the whole query when carrier_challenge is present anywhere', () => {
    expect(
      redactRequestUrl('/oidc/auth?client_id=x&carrier_mode=h5&carrier_challenge=abc&state=s')
    ).toBe('/oidc/auth?<redacted>');
    expect(redactRequestUrl('/sign-in?carrier_challenge=abc')).toBe('/sign-in?<redacted>');
  });

  it('redacts authorization codes and other credentials, case-insensitively', () => {
    expect(redactRequestUrl('/callback/xyz?code=abc&state=s')).toBe('/callback/xyz?<redacted>');
    expect(redactRequestUrl('/x?state=s&Access_Token=t')).toBe('/x?<redacted>');
    expect(redactRequestUrl('/broker/start?lc=abc')).toBe('/broker/start?<redacted>');
  });

  it('only matches whole parameter names', () => {
    expect(redactRequestUrl('/x?error_code=1&barcode=2&lcx=3&x_token=4')).toBe(
      '/x?error_code=1&barcode=2&lcx=3&x_token=4'
    );
  });
});

describe('redactRequestLogLine', () => {
  it('redacts the URL inside a koa-logger request line', () => {
    const url = '/oidc/auth?client_id=x&carrier_challenge=abc';
    const line = `  <-- GET ${url}`;

    expect(redactRequestLogLine(line, ['  <-- %s %s', 'GET', url])).toBe(
      '  <-- GET /oidc/auth?<redacted>'
    );
  });

  it('redacts the URL inside a koa-logger response line and keeps other fields', () => {
    const url = '/callback/xyz?code=abc';
    const line = `  --> GET ${url} 302 12ms 0b`;

    expect(
      redactRequestLogLine(line, ['  %s %s %s %s %s %s', '-->', 'GET', url, 302, '12ms', '0b'])
    ).toBe('  --> GET /callback/xyz?<redacted> 302 12ms 0b');
  });

  it('returns the line unchanged when nothing is sensitive', () => {
    const line = '  <-- GET /api/status';

    expect(redactRequestLogLine(line, ['  <-- %s %s', 'GET', '/api/status'])).toBe(line);
  });
});
