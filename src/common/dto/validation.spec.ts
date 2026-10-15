import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateProductDto } from '../../modules/products/dto/create-product.dto';
import { UpdateProductDto } from '../../modules/products/dto/update-product.dto';
import { CreateOrderDto } from '../../modules/orders/dto/create-order.dto';
import { QueryNotificationDto } from '../../modules/notifications/dto/query-notification.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const product = { sku: 'TEST', name: 'Product', price: 1, stock: 1 };

describe('Request validation', () => {
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
