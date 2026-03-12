import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('property/:propertyId')
  listByProperty(
    @Param('propertyId') propertyId: string,
    @Query('limit') limit?: number,
  ) {
    return this.reviewsService.listByProperty(propertyId, limit);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.reviewsService.getById(id);
  }

  @Post()
  create(@Body() createDto: CreateReviewDto) {
    return this.reviewsService.create(createDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateReviewDto) {
    return this.reviewsService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.reviewsService.remove(id);
  }
}
