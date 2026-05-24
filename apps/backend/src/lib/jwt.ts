import { jwtVerify, SignJWT } from 'jose';
import { env } from '../env.js';

const secret = new TextEncoder().encode(env.GOTRUE_JWT_SECRET);

export interface TokenPayload {
  sub: string;
  email?: string;
  role?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string;
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    ...(env.GOTRUE_JWT_AUDIENCE ? { audience: env.GOTRUE_JWT_AUDIENCE } : {}),
    ...(env.GOTRUE_JWT_ISSUER ? { issuer: env.GOTRUE_JWT_ISSUER } : {}),
  });
  return payload as TokenPayload;
}

export async function signDevToken(opts: {
  sub: string;
  email: string;
  ttlSeconds?: number;
}): Promise<string> {
  if (!env.DEV_AUTH_ENABLED) {
    throw new Error('Dev token signing requested but DEV_AUTH_ENABLED=false');
  }
  const ttl = opts.ttlSeconds ?? 3600;
  return await new SignJWT({ sub: opts.sub, email: opts.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(env.GOTRUE_JWT_ISSUER)
    .setSubject(opts.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secret);
}
