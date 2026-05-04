import { Injectable } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';

@Injectable()
export class RolesService {
  constructor(private readonly convexService: ConvexService) {}

  async getAllPermissions() {
    return await this.convexService.query('permissions:listAll', {});
  }

  async getPermissionsByRole(role: string) {
    return await this.convexService.query('permissions:getByRole', { role });
  }

  async updatePermissions(role: string, module: string, permissions: string[]) {
    return await this.convexService.mutation('permissions:upsert', {
      role,
      module,
      permissions,
    });
  }

  async initializeRole(role: string) {
    return await this.convexService.mutation('permissions:initializeRole', { role });
  }

  getRolesList() {
    return [
      { value: 'admin', label: 'Administrador' },
      { value: 'vendedor', label: 'Vendedor' },
      { value: 'asesor_limitado', label: 'Asesor Limitado' },
      { value: 'contabilidad', label: 'Contabilidad' },
      { value: 'propietario', label: 'Propietario' },
      { value: 'client', label: 'Cliente' },
    ];
  }

  getModulesList() {
    return [
      { value: 'fincas', label: 'Fincas' },
      { value: 'bookings', label: 'Reservas' },
      { value: 'payments', label: 'Pagos' },
      { value: 'users', label: 'Usuarios' },
      { value: 'inbox', label: 'Bandeja de entrada' },
      { value: 'contacts', label: 'Contactos' },
      { value: 'reviews', label: 'Reseñas' },
      { value: 'catalogs', label: 'Catálogos' },
      { value: 'knowledge', label: 'Base de conocimiento' },
      { value: 'reports', label: 'Reportes' },
      { value: 'owner_info', label: 'Info. propietario' },
    ];
  }

  getActionsList() {
    return [
      { value: 'read', label: 'Ver' },
      { value: 'create', label: 'Crear' },
      { value: 'update', label: 'Editar' },
      { value: 'delete', label: 'Eliminar' },
    ];
  }
}