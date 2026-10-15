import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { workerEnabled } from './modules/order-processing/queue.config';

async function bootstrap() {
  if (!workerEnabled()) throw new Error('Worker requires WORKER_ENABLED=true outside Vercel');
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
}

bootstrap().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
