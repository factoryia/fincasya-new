import { Controller, Get } from '@nestjs/common';
import { FincasService } from './fincas.service';

@Controller('properties-simple')
export class PropertiesSimpleController {
  constructor(private readonly fincasService: FincasService) {}

  @Get()
  async listSimple() {
    return this.fincasService.listSimple();
  }

  @Get('v3')
  async listV3() {
    return this.fincasService.listSimple();
  }
}
