/**
 * NiceMatrix (ours): redact credential-bearing query strings from Core request log lines.
 *
 * koa-logger prints `ctx.originalUrl` verbatim, so authorization codes, tokens and the
 * one-tap `carrier_challenge` (the claim key for an already verified phone number, valid
 * for up to 180 s) would otherwise be persisted in the container log. The parameter list
 * mirrors the nginx `nocreds` log format on every NiceMatrix host: when any of them is
 * present, the whole query string is replaced (path is kept for debugging).
 */
const sensitiveParameterPattern =
  /(?:^|&)(?:token|access_token|id_token|refresh_token|authorization|code|client_secret|secret|password|passwd|signature|sig|api_key|apikey|assertion|session|carrier_challenge|lc)=/i;

const redactedQuery = '<redacted>';

export const redactRequestUrl = (url: string): string => {
  const queryStart = url.indexOf('?');

  if (queryStart === -1) {
    return url;
  }

  const query = url.slice(queryStart + 1);

  return sensitiveParameterPattern.test(query)
    ? `${url.slice(0, queryStart)}?${redactedQuery}`
    : url;
};

/** Replace every logged URL argument that carries a sensitive parameter with its redacted form. */
export const redactRequestLogLine = (line: string, args: readonly unknown[]): string =>
  args.reduce<string>((result, argument) => {
    if (typeof argument !== 'string') {
      return result;
    }

    const redacted = redactRequestUrl(argument);

    return redacted === argument ? result : result.split(argument).join(redacted);
  }, line);
