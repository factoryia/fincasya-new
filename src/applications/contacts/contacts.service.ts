import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import {
  buildContactsExcelBuffer,
  buildContactsExportFilename,
} from './contacts-export';

@Injectable()
export class ContactsService {
  constructor(private readonly convexService: ConvexService) {}

  async list(search?: string, limit?: number) {
    try {
      return await this.convexService.query('contacts:list', { search, limit });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async exportExcel(
    search?: string,
    scope: 'todos' | 'clientes' | 'leads' = 'todos',
  ) {
    const contacts = await this.list(search, 10_000);
    return {
      buffer: buildContactsExcelBuffer(contacts, scope),
      filename: buildContactsExportFilename(scope, search),
    };
  }

  async getById(id: string) {
    try {
      const contact = await this.convexService.query('contacts:getById', { contactId: id });
      if (!contact) throw new NotFoundException('Contacto no encontrado');
      return contact;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async getWithHistory(id: string) {
    try {
      const history = await this.convexService.query('contacts:getWithHistory', { contactId: id });
      if (!history) throw new NotFoundException('Contacto no encontrado');
      return history;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async getTimeline(id: string, limit?: number) {
    try {
      return await this.convexService.query('contactTimeline:getTimeline', {
        contactId: id,
        limit,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getProfile(id: string) {
    try {
      const profile = await this.convexService.query(
        'contactTimeline:getContactProfile',
        { contactId: id },
      );
      if (!profile) throw new NotFoundException('Contacto no encontrado');
      return profile;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async listNotes(contactId: string) {
    return this.convexService.query('contactNotes:list', { contactId });
  }

  async createNote(
    contactId: string,
    data: { content: string; authorUserId?: string; authorName?: string },
  ) {
    try {
      return await this.convexService.mutation('contactNotes:create', {
        contactId,
        content: data.content,
        authorUserId: data.authorUserId,
        authorName: data.authorName,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async updateNote(noteId: string, content: string) {
    try {
      return await this.convexService.mutation('contactNotes:update', {
        noteId,
        content,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async deleteNote(noteId: string) {
    try {
      return await this.convexService.mutation('contactNotes:remove', {
        noteId,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async listForCrm(args: {
    search?: string;
    streakFilter?: string;
    birthdayMonth?: boolean;
    page?: number;
    pageSize?: number;
    limit?: number;
  }) {
    try {
      return await this.convexService.query('crmContacts:listForCrm', {
        search: args.search,
        streakFilter: args.streakFilter as any,
        birthdayMonth: args.birthdayMonth,
        page: args.page,
        pageSize: args.pageSize ?? args.limit,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async setTags(id: string, tags: string[]) {
    try {
      return await this.convexService.mutation('contacts:setTagsForContact', {
        contactId: id,
        tags: Array.isArray(tags) ? tags : [],
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async updateContact(
    id: string,
    data: {
      name?: string;
      cedula?: string;
      email?: string;
      city?: string;
      address?: string;
      fechaNacimiento?: string;
      crmType?: 'lead' | 'client';
    },
  ) {
    try {
      return await this.convexService.mutation('contacts:update', {
        contactId: id,
        ...data,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'No se pudo actualizar el contacto',
      );
    }
  }

  async deleteContact(id: string) {
    try {
      return await this.convexService.mutation('contacts:removeContact', {
        contactId: id,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'No se pudo eliminar el contacto',
      );
    }
  }

  async listPipelineDeals(status?: string, limit?: number) {
    try {
      return await this.convexService.query('crmPipeline:listPipelineDeals', {
        status: status || undefined,
        limit,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getPipelineStats() {
    try {
      return await this.convexService.query('crmPipeline:getPipelineStats', {});
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async listBroadcastTemplates() {
    return this.convexService.query('campaignBroadcast:listTemplates', {});
  }

  async checkEligibleContacts(contactIds: string[]) {
    return this.convexService.query('campaignBroadcast:listEligibleContacts', {
      contactIds,
    });
  }

  async sendBroadcast(args: {
    contactIds: string[];
    templateKey: string;
    bodyParams?: string[];
    sentByUserId?: string;
    logToInbox?: boolean;
  }) {
    if (!args.contactIds?.length) {
      throw new BadRequestException('Se requiere al menos un contacto');
    }
    if (!args.templateKey?.trim()) {
      throw new BadRequestException('templateKey es obligatorio');
    }
    try {
      return await this.convexService.action('campaignBroadcast:sendBroadcast', {
        contactIds: args.contactIds,
        templateKey: args.templateKey.trim(),
        bodyParams: Array.isArray(args.bodyParams)
          ? args.bodyParams.map((p) => String(p ?? ''))
          : undefined,
        sentByUserId: args.sentByUserId,
        logToInbox: args.logToInbox,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async listBroadcasts(limit?: number) {
    return this.convexService.query('campaignBroadcast:listBroadcasts', {
      limit: limit ?? 20,
    });
  }
}
