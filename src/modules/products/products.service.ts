import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { PaginatedResult } from '../../common/dto/pagination.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async create(createProductDto: CreateProductDto): Promise<Product> {
    const existingSku = await this.productRepository.findOne({
      where: { sku: createProductDto.sku },
      withDeleted: true,
    });

    if (existingSku) {
      throw new ConflictException(
        `Product with SKU "${createProductDto.sku}" already exists`,
      );
    }

    const product = this.productRepository.create(createProductDto);
    return await this.productRepository.save(product);
  }

  async findAll(query: QueryProductDto): Promise<PaginatedResult<Product>> {
    const { page = 1, limit = 10, search, minPrice, maxPrice, skip } = query;

    const qb: SelectQueryBuilder<Product> = this.productRepository
      .createQueryBuilder('product')
      .where('product.deletedAt IS NULL');

    if (search && search.trim()) {
      qb.andWhere('product.name ILIKE :search', { search: `%${search.trim()}%` });
    }

    if (minPrice !== undefined) {
      qb.andWhere('product.price >= :minPrice', { minPrice });
    }

    if (maxPrice !== undefined) {
      qb.andWhere('product.price <= :maxPrice', { maxPrice });
    }

    qb.orderBy('product.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }

    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);

    if (updateProductDto.sku && updateProductDto.sku !== product.sku) {
      const existingSku = await this.productRepository.findOne({
        where: { sku: updateProductDto.sku },
        withDeleted: true,
      });

      if (existingSku && existingSku.id !== id) {
        throw new ConflictException(
          `Product with SKU "${updateProductDto.sku}" already exists`,
        );
      }
    }

    Object.assign(product, updateProductDto);
    return await this.productRepository.save(product);
  }

  async remove(id: string): Promise<{ message: string; id: string }> {
    const product = await this.findOne(id);
    await this.productRepository.softRemove(product);
    return {
      message: `Product with ID "${id}" soft deleted successfully`,
      id,
    };
  }
}
