import bcrypt from 'bcryptjs';

import { UnauthorizedError } from '../../shared/errors/AppError.js';
import type { UsuarioAutenticado } from './auth.types.js';
import { AuthErrorCode } from './authErrorCodes.js';
import type { TokenService } from './TokenService.js';
import type { UsuarioRepository } from './UsuarioRepository.js';

/**
 * Hash bcrypt válido de un valor aleatorio que nadie conoce. Se compara contra
 * él cuando el correo no existe, para que la respuesta tarde lo mismo que con
 * un usuario real. Sin esto, un atacante podría deducir qué correos están
 * registrados midiendo el tiempo de respuesta (enumeración de usuarios).
 */
const HASH_PARA_USUARIO_INEXISTENTE =
  '$2b$10$R2jQLmqnicyTp1qZJKKkAunXlgPL/KErKLeqtUUvklU8VzbyV39oe';

export interface ResultadoLogin {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  usuario: UsuarioAutenticado;
}

export class AuthService {
  constructor(
    private readonly usuarioRepository: UsuarioRepository,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Valida las credenciales y emite un token de acceso.
   *
   * Ante cualquier fallo (correo inexistente, contraseña incorrecta o usuario
   * inactivo) se responde el MISMO mensaje genérico, para no revelar cuál de
   * los datos era el incorrecto.
   */
  async login(email: string, password: string): Promise<ResultadoLogin> {
    const usuario = await this.usuarioRepository.findByEmail(email);

    // bcrypt.compare es deliberadamente lento (factor de costo 10): encarece
    // los ataques de fuerza bruta incluso si se filtrara la tabla de usuarios.
    const passwordCoincide = await bcrypt.compare(
      password,
      usuario?.passwordHash ?? HASH_PARA_USUARIO_INEXISTENTE,
    );

    if (!usuario || !passwordCoincide || !usuario.activo) {
      throw new UnauthorizedError(
        'Correo o contraseña incorrectos.',
        AuthErrorCode.CREDENCIALES_INVALIDAS,
      );
    }

    const usuarioAutenticado: UsuarioAutenticado = {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      rol: usuario.rol,
    };
    const { accessToken, expiresInSeconds } = await this.tokenService.emitir(usuarioAutenticado);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: expiresInSeconds,
      usuario: usuarioAutenticado,
    };
  }
}
