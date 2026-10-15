import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';

describe('ProductsService', () => {
  let service: ProductsService;
  let repository: any;

  const mockProduct: Product = {
    id: 'prod-uuid-1',
    sku: 'SKU-001',
    name: 'Sample Product',
    price: 100,
    stock: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((p) => Promise.resolve({ ...mockProduct, ...p })),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: getRepositoryToken(Product),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe('create', () => {
    it('should create and return a product if SKU is unique', async () => {
      repository.findOne.mockResolvedValue(null);

      const result = await service.create({
        sku: 'SKU-001',
        name: 'Sample Product',
        price: 100,
        stock: 10,
      });

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { sku: 'SKU-001' },
        withDeleted: true,
      });
      expect(result.sku).toBe('SKU-001');
    });

    it('should throw ConflictException if SKU already exists', async () => {
      repository.findOne.mockResolvedValue(mockProduct);

      await expect(
        service.create({
          sku: 'SKU-001',
          name: 'Duplicate SKU Product',
          price: 100,
          stock: 10,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  it('updates only submitted fields without saving a stale stock snapshot', async () => {
    repository.findOne.mockResolvedValue({ ...mockProduct, stock: 0, name: 'Renamed' });
    const result = await service.update(mockProduct.id, { name: 'Renamed' });
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: mockProduct.id }), { name: 'Renamed' },
    );
    expect(repository.save).not.toHaveBeenCalled();
    expect(result.stock).toBe(0);
  });

  it('returns 404 when updating a deleted or missing product', async () => {
    repository.update.mockResolvedValue({ affected: 0 });
    await expect(service.update(mockProduct.id, { name: 'Renamed' })).rejects.toThrow(NotFoundException);
  });

  describe('findOne', () => {
    it('should return product by id', async () => {
      repository.findOne.mockResolvedValue(mockProduct);
      const result = await service.findOne('prod-uuid-1');
      expect(result.id).toBe('prod-uuid-1');
    });

    it('should throw NotFoundException if product not found', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.findOne('invalid-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft delete product', async () => {
      repository.findOne.mockResolvedValue(mockProduct);
      const result = await service.remove('prod-uuid-1');
      expect(repository.softDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'prod-uuid-1' }));
      expect(result.message).toContain('soft deleted successfully');
    });
  });
});
