/**
 * Roles de usuario. Por defecto nuevos usuarios tienen "user".
 * Solo "admin" puede crear, actualizar y borrar fincas.
 */
export enum UserRole {
  ADMIN = 'admin',
  ASSISTANT = 'assistant',
  VENDEDOR = 'vendedor',
  ASESOR_LIMITADO = 'asesor_limitado',
  CONTABILIDAD = 'contabilidad',
  PROPIETARIO = 'propietario',
  CLIENT = 'client',
  USER = 'user',
}

