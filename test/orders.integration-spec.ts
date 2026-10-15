import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { Queue, QueueEvents, Worker } from 'bullmq';
import request = require('supertest');
import { join } from 'path';
import { Product } from '../src/modules/products/entities/product.entity';
import { Order, OrderStatus } from '../src/modules/orders/entities/order.entity';
import { OrderItem } from '../src/modules/orders/entities/order-item.entity';
import { NotificationLog } from '../src/modules/notifications/entities/notification-log.entity';
import { ProductsService } from '../src/modules/products/products.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ProductsController } from '../src/modules/products/products.controller';
import { OrdersController } from '../src/modules/orders/orders.controller';
import { NotificationsController } from '../src/modules/notifications/notifications.controller';
import { OrderProcessingService } from '../src/modules/order-processing/order-processing.service';
import { OrderProcessingProcessor } from '../src/modules/order-processing/order-processing.processor';
import { OrderRecoveryService } from '../src/modules/order-processing/order-recovery.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { InitialSchema1710000000000 } from '../src/database/migrations/1710000000000-InitialSchema';
import { InventoryConstraints1710000001000 } from '../src/database/migrations/1710000001000-InventoryConstraints';

describe('Orders with real PostgreSQL and Redis', () => {
  const schema = `test_${process.pid}_${Date.now()}`;
  let ds: DataSource, queue: Queue, events: QueueEvents, worker: Worker;
  let app: NestExpressApplication, products: ProductsService, orders: OrdersService;
  let processing: OrderProcessingService, processor: OrderProcessingProcessor, recovery: OrderRecoveryService;
  let sequence = 0;
  const dto = (id: string, quantity = 1) => ({ customerName: 'Integration Test', customerEmail: 'test@example.com', items: [{ productId: id, quantity }] });
  const product = (stock = 5) => products.create({ sku: `TEST-${++sequence}`, name: 'Test product', price: 123.45, stock });
  const stock = async (id: string) => (await products.findOne(id)).stock;
  const logs = (id: string) => ds.getRepository(NotificationLog).countBy({ orderId: id });

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL) {
      throw new Error('Set TEST_DATABASE_URL and TEST_REDIS_URL. Tests use an isolated schema and queue prefix.');
    }
    Logger.overrideLogger(false);
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.connect();
    try { await admin.query(`CREATE SCHEMA "${schema}"`); } finally { await admin.end(); }
    ds = new DataSource({ type: 'postgres', url: process.env.TEST_DATABASE_URL, schema,
      entities: [Product, Order, OrderItem, NotificationLog],
      migrations: [InitialSchema1710000000000, InventoryConstraints1710000001000], synchronize: false,
      extra: { options: `-c search_path=${schema},public`, max: 8 },
    });
    await ds.initialize();
    expect(await ds.runMigrations()).toHaveLength(2);
    const url = new URL(process.env.TEST_REDIS_URL);
    const connection = { host: url.hostname, port: Number(url.port || 6379),
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}), maxRetriesPerRequest: null,
    };
    queue = new Queue('order-processing', { connection, prefix: schema });
    events = new QueueEvents('order-processing', { connection, prefix: schema });
    await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
    products = new ProductsService(ds.getRepository(Product));
    processing = new OrderProcessingService(queue);
    const notifications = new NotificationsService(ds.getRepository(NotificationLog));
    orders = new OrdersService(ds, ds.getRepository(Order), ds.getRepository(OrderItem), ds.getRepository(Product), processing, notifications);
    processor = new OrderProcessingProcessor(ds);
    recovery = new OrderRecoveryService(ds, processing, processor);
    worker = new Worker('order-processing', job => processor.process(job), { connection, prefix: schema, autorun: false });
    worker.on('failed', (job, error) => processor.onJobFailed(job, error));
    void worker.run();
    const module = await Test.createTestingModule({
      controllers: [ProductsController, OrdersController, NotificationsController],
      providers: [{ provide: ProductsService, useValue: products }, { provide: OrdersService, useValue: orders }, { provide: NotificationsService, useValue: notifications }],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useStaticAssets(join(process.cwd(), 'public'));
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Test').build()));
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(async () => {
    await worker.pause();
    await queue.drain(true);
    await ds.query('TRUNCATE notification_logs, order_items, orders, products CASCADE');
    process.env.SIMULATE_FAILURE_RATE = '0';
  });

  afterAll(async () => {
    if (worker) await worker.close();
    if (app) await app.close();
    if (events) await events.close();
    if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
    if (ds?.isInitialized) {
      await ds.query(`DROP SCHEMA "${schema}" CASCADE`);
      await ds.destroy();
    }
  });

  it('does not restore stale inventory when renaming during checkout', async () => {
    const p = await product(1);
    let loaded: () => void, release: () => void;
    const reachedWrite = new Promise<void>(resolve => loaded = resolve);
    const proceed = new Promise<void>(resolve => release = resolve);
    const repo = ds.getRepository(Product);
    const delayed = new Proxy(repo, { get(target, key) {
      if (key === 'save' || key === 'update') return async (...args: unknown[]) => {
        loaded(); await proceed; return target[key].apply(target, args);
      };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const patch = new ProductsService(delayed).update(p.id, { name: 'Renamed' });
    await reachedWrite;
    await orders.create(dto(p.id));
    expect(await stock(p.id)).toBe(0);
    release();
    await patch;
    expect(await stock(p.id)).toBe(0);
    await expect(orders.create(dto(p.id))).rejects.toThrow('Insufficient stock');
  });

  it('accepts exactly one of ten concurrent HTTP orders', async () => {
    const p = await product(1);
    const replies = await Promise.all(Array.from({ length: 10 }, () => request(app.getHttpServer()).post('/orders').send(dto(p.id))));
    expect(replies.filter(r => r.status === 201)).toHaveLength(1);
    expect(replies.filter(r => r.status === 400)).toHaveLength(9);
    expect(await stock(p.id)).toBe(0);
  });

  it('rolls back an entire multi-item order', async () => {
    const p = await product(5);
    await request(app.getHttpServer()).post('/orders').send({ ...dto(p.id), items: [{ productId: p.id, quantity: 1 }, { productId: p.id, quantity: 99 }] }).expect(400);
    expect(await stock(p.id)).toBe(5);
    expect(await ds.getRepository(Order).count()).toBe(0);
  });

  it('keeps historical prices and refunds only once under concurrent cancellation', async () => {
    const p = await product(5), order = await orders.create(dto(p.id, 2));
    await products.update(p.id, { price: 200 });
    const snapshot = await orders.findOne(order.id);
    expect(snapshot.totalAmount).toBe(246.9);
    expect(snapshot.items[0].unitPrice).toBe(123.45);
    const replies = await Promise.all([request(app.getHttpServer()).patch(`/orders/${order.id}/cancel`), request(app.getHttpServer()).patch(`/orders/${order.id}/cancel`)]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 400]);
    expect(await stock(p.id)).toBe(5);
    expect(await logs(order.id)).toBe(1);
  });

  it.each([
    { name: 'x'.repeat(256) }, { stock: 2147483648 }, { price: 1.005 }, { stock: true },
  ])('returns 400 for invalid product %j', async invalid => {
    await request(app.getHttpServer()).post('/products').send({ sku: 'INVALID', name: 'Valid', price: 1, stock: 1, ...invalid }).expect(400);
  });

  it('returns 400 for null PATCH and invalid notification limit', async () => {
    const p = await product();
    await request(app.getHttpServer()).patch(`/products/${p.id}`).send({ name: null }).expect(400);
    await request(app.getHttpServer()).get('/notifications?limit=-1').expect(400);
  });

  it('returns 409 for a concurrent duplicate SKU', async () => {
    const body = { sku: 'DUPLICATE', name: 'Product', price: 1, stock: 1 };
    const replies = await Promise.all([request(app.getHttpServer()).post('/products').send(body), request(app.getHttpServer()).post('/products').send(body)]);
    expect(replies.map(r => r.status).sort()).toEqual([201, 409]);
  });

  it('soft-deletes without changing inventory and rejects purchases of deleted products', async () => {
    const p = await product(1);
    await orders.create(dto(p.id));
    await products.remove(p.id);
    const deleted = await ds.getRepository(Product).findOne({ where: { id: p.id }, withDeleted: true });
    expect(deleted.stock).toBe(0);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    await request(app.getHttpServer()).get(`/products/${p.id}`).expect(404);
    await request(app.getHttpServer()).post('/orders').send(dto(p.id)).expect(400);
  });

  it('recovers a committed order after enqueue failed and confirms it once', async () => {
    const p = await product(2);
    const outage = jest.spyOn(processing, 'addOrderJob').mockRejectedValueOnce(new Error('Injected Redis outage'));
    const order = await orders.create(dto(p.id));
    outage.mockRestore();
    expect((await processing.getOrderJobStatus(order.id)).state).toBe('not_found');
    await recovery.reconcile();
    const job = await queue.getJob(order.id);
    expect(job).toBeDefined();
    await worker.resume();
    await job.waitUntilFinished(events, 30000);
    expect((await orders.findOne(order.id)).status).toBe(OrderStatus.CONFIRMED);
    await processor.process(job);
    expect(await logs(order.id)).toBe(1);
    expect(await stock(p.id)).toBe(1);
  });

  it('retries three times, recovers a failed refund after restart, and does not refund twice', async () => {
    process.env.SIMULATE_FAILURE_RATE = '1';
    const p = await product(2), order = await orders.create(dto(p.id));
    const job = await queue.getJob(order.id);
    await worker.resume();
    await expect(job.waitUntilFinished(events, 45000)).rejects.toThrow();
    expect((await queue.getJob(order.id)).attemptsMade).toBe(3);
    const transaction = ds.transaction.bind(ds);
    const outage = jest.spyOn(ds, 'transaction').mockImplementationOnce((async (callback: any) => transaction(async manager => {
      manager.increment = async () => { throw new Error('Injected refund DB outage'); };
      return callback(manager);
    })) as typeof ds.transaction);
    await recovery.reconcile();
    outage.mockRestore();
    expect((await orders.findOne(order.id)).status).toBe(OrderStatus.PENDING);
    expect(await stock(p.id)).toBe(1);
    await new OrderRecoveryService(ds, processing, processor).reconcile();
    expect((await orders.findOne(order.id)).status).toBe(OrderStatus.FAILED);
    expect(await stock(p.id)).toBe(2);
    await processor.failOrder(order.id, 'duplicate');
    expect(await stock(p.id)).toBe(2);
    expect(await logs(order.id)).toBe(1);
  });

  it('does not confirm a cancelled order and expires stale orders once', async () => {
    const p = await product(3), order = await orders.create(dto(p.id));
    await orders.cancel(order.id);
    await processor.process(await queue.getJob(order.id));
    expect((await orders.findOne(order.id)).status).toBe(OrderStatus.CANCELLED);
    const stale = await orders.create(dto(p.id, 2));
    await ds.query('UPDATE orders SET "createdAt"=NOW()-INTERVAL \'31 minutes\' WHERE id=$1', [stale.id]);
    const cleanup = await queue.add('cleanup-stale-orders', {});
    expect(await processor.process(cleanup)).toEqual({ cleanedCount: 1 });
    expect(await processor.process(cleanup)).toEqual({ cleanedCount: 0 });
    expect(await stock(p.id)).toBe(3);
    expect(await logs(stale.id)).toBe(1);
  });

  it('enforces database stock constraints and exposes useful Swagger schemas', async () => {
    const p = await product();
    await expect(ds.query('UPDATE products SET stock=-1 WHERE id=$1', [p.id])).rejects.toThrow();
    const document = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(document.body.components.schemas.Product.properties.stock).toBeDefined();
    expect(document.body.components.schemas.Order.properties.items).toBeDefined();
    await ds.undoLastMigration();
    expect(await ds.runMigrations()).toHaveLength(1);
  });
});
