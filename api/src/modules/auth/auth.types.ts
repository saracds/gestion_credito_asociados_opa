/**
 * Roles del sistema . Deben coincidir con CK_Usuarios_rol en la BD.
 *   ADMIN     Todo, incluido eliminar créditos.
 *   ANALISTA  Crear, editar y cambiar el estado de créditos.
 *   CONSULTA  Solo lectura.
 */
export const ROLES = ['ADMIN', 'ANALISTA', 'CONSULTA'] as const;
export type Rol = (typeof ROLES)[number];

/** Grupos de roles reutilizados en la autorización de las rutas. */
export const ROLES_LECTURA: readonly Rol[] = ['ADMIN', 'ANALISTA', 'CONSULTA'];
export const ROLES_GESTION: readonly Rol[] = ['ADMIN', 'ANALISTA'];
export const ROLES_ADMINISTRACION: readonly Rol[] = ['ADMIN'];

/** Usuario identificado a partir de un token válido. Viaja en `request.usuario`. */
export interface UsuarioAutenticado {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
}

/** Registro de usuario tal como se lee de la base de datos. */
export interface UsuarioRegistrado extends UsuarioAutenticado {
  passwordHash: string;
  activo: boolean;
}
