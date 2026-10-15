import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateProductDto } from '../../modules/products/dto/create-product.dto';
import { UpdateProductDto } from '../../modules/products/dto/update-product.dto';
import { CreateOrderDto } from '../../modules/orders/dto/create-order.dto';
import { QueryNotificationDto } from '../../modules/notifications/dto/query-notification.dto';
import { QueryProductDto } from '../../modules/products/dto/query-product.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const product = { sku: 'TEST', name: 'Product', price: 1, stock: 1 };

describe('Request validation', () => {
  it.each([
    { minPrice: '-2' }, { maxPrice: '-2' }, { minPrice: 'abc' }, { maxPrice: 'Infinity' },
  ])('rejects invalid product price filter %j', async query => {
    await expect(pipe.transform(query, { type: 'query', metatype: QueryProductDto }))
      .rejects.toThrow(BadRequestException);
  });
  it.each([{}, { minPrice: '0' }, { maxPrice: '0' }, { minPrice: '1.25', maxPrice: '2.5' }])
    ('allows optional, zero and decimal price filters %j', async query => {
      await expect(pipe.transform(query, { type: 'query', metatype: QueryProductDto }))
        .resolves.toBeInstanceOf(QueryProductDto);
    });
  it.each([
    { name: 'x'.repeat(256) }, { sku: 'x'.repeat(101) }, { name: '   ' },
    { stock: 2147483648 }, { stock: true }, { price: 1.005 }, { price: 10000000000 },
    { price: null }, { extra: true },
  ])('rejects invalid product %j', async patch => {
    await expect(pipe.transform({ ...product, ...patch }, { type: 'body', metatype: CreateProductDto }))
      .rejects.toThrow(BadRequestException);
  });
  it.each(['sku', 'name', 'price', 'stock'])('rejects null PATCH %s', async field => {
    await expect(pipe.transform({ [field]: null }, { type: 'body', metatype: UpdateProductDto }))
      .rejects.toThrow(BadRequestException);
  });
  it('allows omitted PATCH properties and trims text', async () => {
    await expect(pipe.transform({ name: '  Updated  ' }, { type: 'body', metatype: UpdateProductDto }))
      .resolves.toEqual({ name: 'Updated' });
  });
  it.each(['-1', '0', '101', 'abc', '1.5'])('rejects notification limit %s', async limit => {
    await expect(pipe.transform({ limit }, { type: 'query', metatype: QueryNotificationDto }))
      .rejects.toThrow(BadRequestException);
  });
  it('rejects boolean quantity and overlong customer name', async () => {
    await expect(pipe.transform({ customerName: 'x'.repeat(256), customerEmail: 'test@example.com',
      items: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: true }],
    }, { type: 'body', metatype: CreateOrderDto })).rejects.toThrow(BadRequestException);
  });
});
