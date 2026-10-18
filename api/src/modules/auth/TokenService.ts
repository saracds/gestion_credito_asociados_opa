import { randomUUID } from 'node:crypto';

import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import { UnauthorizedError } from '../../shared/errors/AppError.js';
import { ROLES, type UsuarioAutenticado } from './auth.types.js';
import { AuthErrorCode } from './authErrorCodes.js';

export interface TokenServiceConfig {
  secret: string;
  issuer: string;
  audience: string;
  expiresInMinutes: number;
}

export interface TokenEmitido {
  accessToken: string;
  expiresInSeconds: number;
}

/** Algoritmo permitido. Se fija explícitamente para impedir ataques de "alg: none" o de confusión de algoritmo. */
const ALGORITHM = 'HS256';

/** Contenido esperado del token; se valida aunque la firma sea correcta (defensa en profundidad). */
const tokenClaimsSchema = z.object({
  sub: z.string().regex(/^\d+$/),
  email: z.string(),
  nombre: z.string(),
  rol: z.enum(ROLES),
});

/**
 * Emite y verifica JSON Web Tokens.
 *
 * Por qué JWT: el token es autocontenido y firmado. La API verifica la firma
 * sin consultar la base de datos ni guardar sesiones, por lo que cualquier
 * réplica de la API puede atender cualquier petición (servicio stateless,
 * clave para escalar horizontalmente).
 *
 * Por qué HS256 (HMAC con secreto compartido): una sola API emite y verifica
 * los tokens. Si en el futuro otros servicios necesitaran verificarlos sin
 * poder emitirlos, convendría RS256/ES256 (par de claves pública/privada).
 *
 * Cada token incluye:
 *   sub   id del usuario        iss / aud  quién lo emitió y para quién
 *   rol   para autorizar        iat / exp  emisión y vencimiento
 *   jti   identificador único   (permitiría una lista de revocación futura)
 */
export class TokenService {
  private readonly signingKey: Uint8Array;

  constructor(private readonly config: TokenServiceConfig) {
    this.signingKey = new TextEncoder().encode(config.secret);
  }

  async emitir(usuario: UsuarioAutenticado): Promise<TokenEmitido> {
    const accessToken = await new SignJWT({
      email: usuario.email,
      nombre: usuario.nombre,
      rol: usuario.rol,
    })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(String(usuario.id))
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.config.expiresInMinutes}m`)
      .setJti(randomUUID())
      .sign(this.signingKey);

    return { accessToken, expiresInSeconds: this.config.expiresInMinutes * 60 };
  }

  /**
   * Verifica firma, emisor, audiencia, vencimiento y contenido del token.
   * @throws UnauthorizedError (401) con código TOKEN_EXPIRADO o TOKEN_INVALIDO.
   */
  async verificar(accessToken: string): Promise<UsuarioAutenticado> {
    try {
      const { payload } = await jwtVerify(accessToken, this.signingKey, {
        algorithms: [ALGORITHM],
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
      const claims = tokenClaimsSchema.parse(payload);

      return {
        id: Number(claims.sub),
        email: claims.email,
        nombre: claims.nombre,
        rol: claims.rol,
      };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new UnauthorizedError(
          'La sesión expiró. Inicie sesión nuevamente.',
          AuthErrorCode.TOKEN_EXPIRADO,
        );
      }
      throw new UnauthorizedError('El token de acceso no es válido.', AuthErrorCode.TOKEN_INVALIDO);
    }
  }
}
