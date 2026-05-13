import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CategoryZoneTemplatesService } from './category-zone-templates.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';
import { IsNumber, IsOptional, IsString, MinLength, Min } from 'class-validator';

class CreateTemplateBody {
  @IsString()
  @MinLength(1)
  name!: string;
}

class UpdateTemplateBody {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}

class AddTemplateFeatureBody {
  @IsString()
  iconographyId!: string;

  @IsOptional()
  @IsString()
  alias?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;
}

class UpdateTemplateFeatureBody {
  @IsOptional()
  @IsString()
  alias?: string;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsString()
  iconographyId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;
}

@Controller('category-zone-templates')
export class CategoryZoneTemplatesController {
  constructor(private readonly svc: CategoryZoneTemplatesService) {}

  @Get('all')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  listAll() {
    return this.svc.listAll();
  }

  @Post('templates')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  createStandalone(@Body() body: CreateTemplateBody) {
    return this.svc.create('ESTANDAR', body.name);
  }

  @Post('templates/:zoneTemplateId/features')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  addFeature(
    @Param('zoneTemplateId') zoneTemplateId: string,
    @Body() body: AddTemplateFeatureBody,
  ) {
    return this.svc.addFeature(zoneTemplateId, body);
  }

  @Patch('templates/:id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  updateTemplate(@Param('id') id: string, @Body() body: UpdateTemplateBody) {
    return this.svc.updateTemplate(id, body);
  }

  @Delete('templates/:id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  deleteTemplate(@Param('id') id: string) {
    return this.svc.deleteTemplate(id);
  }

  @Patch('features/:id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  updateFeature(@Param('id') id: string, @Body() body: UpdateTemplateFeatureBody) {
    return this.svc.updateFeature(id, body);
  }

  @Delete('features/:id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  removeFeature(@Param('id') id: string) {
    return this.svc.removeFeature(id);
  }

  @Get(':propertyCategory')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  list(@Param('propertyCategory') propertyCategory: string) {
    return this.svc.list(propertyCategory);
  }

  @Post(':propertyCategory')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  create(
    @Param('propertyCategory') propertyCategory: string,
    @Body() body: CreateTemplateBody,
  ) {
    return this.svc.create(propertyCategory, body.name);
  }
}
