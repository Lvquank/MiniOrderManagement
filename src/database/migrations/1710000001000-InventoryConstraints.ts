import { MigrationInterface, QueryRunner } from 'typeorm';

export class InventoryConstraints1710000001000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE products ADD CONSTRAINT "CHK_products_stock" CHECK (stock >= 0), ADD CONSTRAINT "CHK_products_price" CHECK (price >= 0)');
    await queryRunner.query('ALTER TABLE order_items ADD CONSTRAINT "CHK_order_items_quantity" CHECK (quantity > 0), ADD CONSTRAINT "CHK_order_items_price" CHECK ("unitPrice" >= 0)');
    await queryRunner.query('ALTER TABLE orders ADD CONSTRAINT "CHK_orders_total" CHECK ("totalAmount" >= 0)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE orders DROP CONSTRAINT "CHK_orders_total"');
    await queryRunner.query('ALTER TABLE order_items DROP CONSTRAINT "CHK_order_items_quantity", DROP CONSTRAINT "CHK_order_items_price"');
    await queryRunner.query('ALTER TABLE products DROP CONSTRAINT "CHK_products_stock", DROP CONSTRAINT "CHK_products_price"');
  }
}
