import type { Request, RequestHandler } from 'express';

import { ForbiddenError, UnauthorizedError } from '../../shared/errors/AppError.js';
import type { Rol, UsuarioAutenticado } from './auth.types.js';
import { AuthErrorCode } from './authErrorCodes.js';
import type { TokenService } from './TokenService.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * AUTENTICACIÓN — "¿quién es?"
 * Exige `Authorization: Bearer <token>`, lo verifica y deja el usuario en
 * `request.usuario`. Sin token válido responde 401.
 */
export function authenticate(tokenService: TokenService): RequestHandler {
  return async (request, _response, next) => {
    const authorizationHeader = request.headers.authorization;

    if (!authorizationHeader?.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError(
        'Debe enviar el token de acceso en la cabecera Authorization: Bearer <token>.',
        AuthErrorCode.TOKEN_REQUERIDO,
      );
    }

    const accessToken = authorizationHeader.slice(BEARER_PREFIX.length).trim();
    request.usuario = await tokenService.verificar(accessToken);
    next();
  };
}

/**
 * AUTORIZACIÓN — "¿puede hacer esto?"
 * Se usa después de `authenticate`. Si el rol del usuario no está entre los
 * permitidos responde 403.
 */
export function authorize(rolesPermitidos: readonly Rol[]): RequestHandler {
  return (request, _response, next) => {
    const usuario = getUsuarioAutenticado(request);
    if (!rolesPermitidos.includes(usuario.rol)) {
      throw new ForbiddenError(
        `Su rol (${usuario.rol}) no tiene permiso para esta operación. Roles permitidos: ${rolesPermitidos.join(', ')}.`,
      );
    }
    next();
  };
}

/** Obtiene el usuario autenticado; falla con 401 si la ruta no pasó por `authenticate`. */
export function getUsuarioAutenticado(request: Request): UsuarioAutenticado {
  if (!request.usuario) {
    throw new UnauthorizedError();
  }
  return request.usuario;
}
