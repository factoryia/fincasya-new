import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

interface PermissionUpdateDto {
  module: string;
  permissions: string[];
}

@Controller('roles')
@UseGuards(ConvexAuthGuard, AdminGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  async getAllRoles() {
    const permissions = await this.rolesService.getAllPermissions();
    const roles = this.rolesService.getRolesList();
    const modules = this.rolesService.getModulesList();
    const actions = this.rolesService.getActionsList();

    const grouped: Record<string, Record<string, string[]>> = {};

    for (const role of roles) {
      grouped[role.value] = {};
    }

    for (const perm of permissions) {
      if (!grouped[perm.role]) grouped[perm.role] = {};
      grouped[perm.role][perm.module] = perm.permissions;
    }

    for (const role of roles) {
      if (!grouped[role.value] || Object.keys(grouped[role.value]).length === 0) {
        for (const mod of modules) {
          if (!grouped[role.value][mod.value]) {
            grouped[role.value][mod.value] = [];
          }
        }
      }
    }

    return { roles, modules, actions, permissions: grouped };
  }

  @Get(':role')
  async getRolePermissions(@Param('role') role: string) {
    const permissions = await this.rolesService.getPermissionsByRole(role);
    const modules = this.rolesService.getModulesList();
    const actions = this.rolesService.getActionsList();

    const grouped: Record<string, string[]> = {};
    for (const perm of permissions) {
      grouped[perm.module] = perm.permissions;
    }

    for (const mod of modules) {
      if (!grouped[mod.value]) grouped[mod.value] = [];
    }

    return { role, permissions: grouped, modules, actions };
  }

  @Put(':role')
  async updateRolePermissions(
    @Param('role') role: string,
    @Body() body: { permissions: PermissionUpdateDto[] },
  ) {
    for (const perm of body.permissions) {
      await this.rolesService.updatePermissions(role, perm.module, perm.permissions);
    }
    return { success: true, role };
  }

  @Post(':role/initialize')
  async initializeRole(@Param('role') role: string) {
    await this.rolesService.initializeRole(role);
    return { success: true, role };
  }
}