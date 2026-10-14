import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1710000000000 implements MigrationInterface {
  name = 'InitialSchema1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create pgcrypto extension for gen_random_uuid() if not exists
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // 2. Create products table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "products" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "sku" varchar(100) NOT NULL UNIQUE,
        "name" varchar(255) NOT NULL,
        "price" numeric(12, 2) NOT NULL,
        "stock" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_products_sku" ON "products" ("sku");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_products_name" ON "products" ("name");`,
    );

    // 3. Create enum type for order status
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "orders_status_enum" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'FAILED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // 4. Create orders table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "orders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "customerName" varchar(255) NOT NULL,
        "customerEmail" varchar(255) NOT NULL,
        "totalAmount" numeric(12, 2) NOT NULL DEFAULT 0,
        "status" "orders_status_enum" NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_orders_status" ON "orders" ("status");`,
    );

    // 5. Create order_items table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderId" uuid NOT NULL,
        "productId" uuid NOT NULL,
        "quantity" integer NOT NULL,
        "unitPrice" numeric(12, 2) NOT NULL,
        CONSTRAINT "FK_order_items_order" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_items_product" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_items_orderId" ON "order_items" ("orderId");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_items_productId" ON "order_items" ("productId");`,
    );

    // 6. Create notification_logs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderId" uuid NOT NULL,
        "customerEmail" varchar(255) NOT NULL,
        "title" varchar(255) NOT NULL,
        "message" text NOT NULL,
        "status" varchar(50) NOT NULL DEFAULT 'SENT',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_logs_orderId" ON "notification_logs" ("orderId");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_logs";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_items";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orders";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "orders_status_enum";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products";`);
  }
}
