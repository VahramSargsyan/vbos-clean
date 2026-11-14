/**
 * Finance B12 — session-bound, purpose-separated CSRF proof.
 *
 * The caller MUST first validate the existing Clean owner session using
 * server.mjs sessionValid(req). This module never authenticates a cookie.
 * The token is HMAC-derived from that exact HttpOnly signed session value,
 * cannot be replayed across sessions, and is never a financial write permit.
 */
import {createHmac,timingSafeEqual} from 'node:crypto';

const TOKEN_PATTERN=/^[0-9a-f]{64}$/;
const SESSION_PATTERN=/^\d{10,13}\.[A-Za-z0-9_-]{16,64}\.[0-9a-f]{64}$/;
const PURPOSE='VBOS_FINANCE_B12_CSRF_V1\u0000';

export function financeCsrfForValidatedSession(sessionCookie,secret){
 if(typeof secret!=='string'||secret.length<40)
  throw Error('B12_CSRF_SIGNING_SECRET_MISSING');
 if(typeof sessionCookie!=='string'||!SESSION_PATTERN.test(sessionCookie))
  return null;
 return createHmac('sha256',secret).update(PURPOSE+sessionCookie).digest('hex');
}

export function verifyFinanceCsrfForValidatedSession(headerValue,sessionCookie,secret){
 const expected=financeCsrfForValidatedSession(sessionCookie,secret);
 if(typeof headerValue!=='string'||!TOKEN_PATTERN.test(headerValue)||!expected)
  return false;
 return timingSafeEqual(Buffer.from(headerValue,'hex'),Buffer.from(expected,'hex'));
}
