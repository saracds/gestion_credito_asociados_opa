import type { UsuarioAutenticado } from '../modules/auth/auth.types.js';

/**
 * Extiende el tipo Request de Express con el usuario autenticado.
 * Lo asigna el middleware `authenticate` después de verificar el JWT.
 */
declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}

export {};
