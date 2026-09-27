import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import Decimal from 'decimal.js';

@Injectable()
export class InventoryService {
  constructor(private readonly dataSource: DataSource) {}

  async dispatchSaleItems(
    queryRunner: QueryRunner,
    tenantId: string,
    warehouseId: string,
    items: Array<{ productId: string; quantity: number }>,
    invoiceNumber: string,
    userId: string
  ): Promise<number> {
    let totalInventoryCost = new Decimal(0);

    for (const item of items) {
      const quants = await queryRunner.query(
        `SELECT id, quantity_on_hand FROM stock_quants 
         WHERE tenant_id = $1 AND product_id = $2 AND warehouse_id = $3
         FOR UPDATE`,
        [tenantId, item.productId, warehouseId]
      );

      if (quants.length === 0) {
        throw new BadRequestException(`El producto ${item.productId} no esta habilitado en esta bodega`);
      }

      const currentStock = new Decimal(quants[0].quantity_on_hand);
      const requestedQty = new Decimal(item.quantity);

      if (currentStock.lessThan(requestedQty)) {
        throw new BadRequestException(
          `Stock insuficiente. Disponible: ${currentStock.toFixed(3)}, Solicitado: ${requestedQty.toFixed(3)}`
        );
      }

      const product = await queryRunner.query(
        `SELECT cost_price FROM products WHERE tenant_id = $1 AND id = $2`,
        [tenantId, item.productId]
      );

      const unitCost = new Decimal(product[0].cost_price);
      const moveCost = unitCost.times(requestedQty);
      totalInventoryCost = totalInventoryCost.plus(moveCost);

      const newStock = currentStock.minus(requestedQty);

      await queryRunner.query(
        `UPDATE stock_quants SET quantity_on_hand = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newStock.toNumber(), quants[0].id]
      );

      await queryRunner.query(
        `INSERT INTO stock_moves (
          tenant_id, product_id, warehouse_id, move_type, quantity,
          unit_cost, previous_stock, new_stock, reference_document, created_by
        ) VALUES ($1, $2, $3, 'SALE_DISPATCH', $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          item.productId,
          warehouseId,
          requestedQty.toNumber(),
          unitCost.toNumber(),
          currentStock.toNumber(),
          newStock.toNumber(),
          invoiceNumber,
          userId,
        ]
      );
    }

    return totalInventoryCost.toNumber();
  }

  async receivePurchaseItems(
    queryRunner: QueryRunner,
    tenantId: string,
    warehouseId: string,
    items: Array<{ productId: string; quantity: number; unitCost: number }>,
    supplierInvoice: string,
    userId: string
  ): Promise<void> {
    for (const item of items) {
      const product = await queryRunner.query(
        `SELECT cost_price FROM products WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, item.productId]
      );

      const quants = await queryRunner.query(
        `SELECT id, quantity_on_hand FROM stock_quants 
         WHERE tenant_id = $1 AND product_id = $2 AND warehouse_id = $3
         FOR UPDATE`,
        [tenantId, item.productId, warehouseId]
      );

      const currentQty = quants.length > 0 ? new Decimal(quants[0].quantity_on_hand) : new Decimal(0);
      const currentCost = new Decimal(product[0].cost_price);

      const incomingQty = new Decimal(item.quantity);
      const incomingCost = new Decimal(item.unitCost);

      const currentTotalVal = currentQty.times(currentCost);
      const incomingTotalVal = incomingQty.times(incomingCost);
      const newTotalQty = currentQty.plus(incomingQty);

      let newCpp = incomingCost;
      if (newTotalQty.greaterThan(0)) {
        newCpp = currentTotalVal.plus(incomingTotalVal).dividedBy(newTotalQty);
      }

      await queryRunner.query(
        `UPDATE products SET cost_price = $1 WHERE id = $2`,
        [newCpp.toNumber(), item.productId]
      );

      if (quants.length > 0) {
        await queryRunner.query(
          `UPDATE stock_quants SET quantity_on_hand = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [newTotalQty.toNumber(), quants[0].id]
        );
      } else {
        await queryRunner.query(
          `INSERT INTO stock_quants (tenant_id, product_id, warehouse_id, quantity_on_hand)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, item.productId, warehouseId, newTotalQty.toNumber()]
        );
      }

      await queryRunner.query(
        `INSERT INTO stock_moves (
          tenant_id, product_id, warehouse_id, move_type, quantity,
          unit_cost, previous_stock, new_stock, reference_document, created_by
        ) VALUES ($1, $2, $3, 'PURCHASE_RECEIPT', $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          item.productId,
          warehouseId,
          incomingQty.toNumber(),
          incomingCost.toNumber(),
          currentQty.toNumber(),
          newTotalQty.toNumber(),
          supplierInvoice,
          userId,
        ]
      );
    }
  }
}
