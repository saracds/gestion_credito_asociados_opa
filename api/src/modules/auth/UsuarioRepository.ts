import sql from 'mssql';

import type { DatabaseClient } from '../../infrastructure/database/DatabaseClient.js';
import type { Rol, UsuarioRegistrado } from './auth.types.js';

export interface UsuarioRepository {
  findByEmail(email: string): Promise<UsuarioRegistrado | null>;
}

interface UsuarioRow {
  id: number;
  email: string;
  nombreCompleto: string;
  passwordHash: string;
  rol: Rol;
  activo: boolean;
}

/** Acceso a la tabla dbo.Usuarios. */
export class SqlServerUsuarioRepository implements UsuarioRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findByEmail(email: string): Promise<UsuarioRegistrado | null> {
    const result = await this.database.createRequest().input('email', sql.NVarChar(254), email)
      .query<UsuarioRow>(`
        SELECT id, email, nombreCompleto, passwordHash, rol, activo
        FROM dbo.Usuarios
        WHERE email = @email;
      `);

    const row = result.recordset[0];
    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      nombre: row.nombreCompleto,
      passwordHash: row.passwordHash,
      rol: row.rol,
      activo: row.activo,
    };
  }
}
