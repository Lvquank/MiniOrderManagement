import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  // Global uniform HTTP exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Enable CORS
  app.enableCors();

  // Serve static UI from public directory
  app.useStaticAssets(join(process.cwd(), 'public'));

  // Swagger Documentation configuration at /api/docs
  const config = new DocumentBuilder()
    .setTitle('Mini Order Management API')
    .setDescription(
      `## HEMIDI - Fresher NodeJS Developer Assessment
Backend system for an online store: Products, Inventory, Orders, and BullMQ Background Queue.

### Key Capabilities:
- **Products**: CRUD, soft delete, pagination, name search, price filtering.
- **Orders**: Atomic transactions and row-level pessimistic locking (\`SELECT ... FOR UPDATE\`).
- **BullMQ Queue ('order-processing')**: Simulated 3-5s processing, ~30% random error, 3 total attempts with exponential backoff (2s, 4s), stock refund and idempotency guards.
- **Recovery**: Worker reconciles PENDING orders every 5s to recover missing jobs and retry failed stock refunds.
- **Repeatable Cleanup**: 5-minute cron job auto-cancelling stale PENDING orders (>30m) and refunding stock.
      `,
    )
    .setVersion('1.0.0')
    .addTag('products', 'Product and Inventory Management')
    .addTag('orders', 'Order Placement, Cancellation and Job Monitoring')
    .addTag('notifications', 'Notification Logs and Audit Trail')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'HEMIDI - Mini Order Management API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
    },
  });

  const port = process.env.PORT || 3000;
  app.enableShutdownHooks();
  await app.listen(port);
  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📚 Swagger documentation available at: http://localhost:${port}/api/docs`);
  logger.log(`🖥️ Web Dashboard available at: http://localhost:${port}`);
}

bootstrap().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
