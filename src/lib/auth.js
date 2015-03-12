import hawk from 'hawk';

const BEWIT_EXPIRATION = 60 * 60;

export function getSignedUrl(url, clientId, accessToken) {
  let credentials = {
    id: clientId,
    key: accessToken,
    algorithm: 'sha256'
  };
  let bewit = hawk.client.getBewit(url, {
    credentials: credentials,
    ttlSec: BEWIT_EXPIRATION
  });
  return `${url}?bewit=${bewit}`;
}
