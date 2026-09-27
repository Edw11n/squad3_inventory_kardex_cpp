# GUÍA INDIVIDUAL DE TRABAJO: ESCUADRÓN 3
## INVENTARIO MULTI-BODEGA & KARDEX PROMEDIO PONDERADO (CPP)
### DIPLOMADO DE OPCIÓN DE GRADO EN DESARROLLO DE SOFTWARE 4.0 (MÓDULOS 4 Y 5)
**Institución Universitaria del Putumayo - UniPutumayo (Sede Mocoa)**  
**Facultad de Tecnologías de la Información y la Comunicación**  
**Programa:** Tecnología en Desarrollo de Software (VI Semestre)  
**Docente Titular y Arquitecto Principal:** Anderson Stiven Moncayo Bermeo  
**Espacio de Trabajo:** Sala de Cómputo 121  

---

## 1. MISIÓN DE SU ESCUADRÓN
Ustedes administran el stock físico y valorizado del comercio. Su responsabilidad es garantizar el control de existencias en múltiples bodegas con soporte de cantidades fraccionarias (metros, kilos, bultos), evitar condiciones de carrera (overselling) mediante bloqueo transaccional `SELECT ... FOR UPDATE` y mantener el Kardex valorizado inmutable recalculando el Costo Promedio Ponderado (CPP) en cada entrada de compra.

---

## 2. ESTRUCTURA INTERNA DE SUS 4 INTEGRANTES (SCRUM AUTÓNOMO)
* **Integrante 1 (Squad Lead & Scrum Master):** Coordina los contratos de productos con los equipos de POS (E4 y E5) y Compras (E7), y modera el Daily de 5 minutos.
* **Integrante 2 (Concurrency & Quant Specialist):** Codifica las funciones de salida de inventario con bloqueo `FOR UPDATE` en `stock_quants`.
* **Integrante 3 (CPP & Valuation Specialist):** Codifica la fórmula matemática del Costo Promedio Ponderado y la inserción append-only en `stock_moves`.
* **Integrante 4 (QA & Performance Specialist):** Escribe pruebas de concurrencia que simulan a dos cajeros intentando vender la última unidad al mismo milisegundo para validar que uno de ellos sea rechazado limpiamente.

---

## 3. SUS DEPENDENCIAS TÉCNICAS
* **Qué necesitan de los demás:**
  * El contexto `tenant_id` y las tablas del Escuadrón 1.
  * La recepción física de facturas de compra del Escuadrón 7 para ingresar stock y recalcular CPP.
* **Qué le entregan a los demás:**
  * El catálogo de productos (`GET /api/v1/inventory/products`) para el mostrador de E4 y la app móvil de E5.
  * El costo de la mercancía saliente (`totalInventoryCost`) para que el Escuadrón 2 cause el asiento contable (613505 deb / 143505 cred).
  * El historial de movimientos en `stock_moves` para que el Escuadrón 6 exporte el Kardex a Excel.

---

## 4. ESTRUCTURA HEXAGONAL DE SU CÓDIGO
Su código vive en `apps/api/src/modules/inventory/`:

```
apps/api/src/modules/inventory/
├── domain/
│   └── entities/product.entity.ts
├── application/
│   ├── ports/
│   │   ├── in/manage-stock.use-case.ts
│   │   └── out/inventory-repository.port.ts
│   └── services/inventory.service.ts
└── infrastructure/
    ├── adapters/
    │   ├── in/inventory.controller.ts
    │   └── out/postgres-inventory.repository.ts
    └── inventory.module.ts
```

---

## 5. CÓDIGO DE PRODUCCIÓN LISTO PARA IMPLEMENTAR

```typescript
// apps/api/src/modules/inventory/inventory.service.ts
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
      // Bloqueo estricto para evitar condiciones de carrera
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

      // Formula Matematica de Costo Promedio Ponderado (CPP)
      // Nuevo CPP = ((Stock_Actual * Costo_Actual) + (Cantidad_Entrante * Costo_Entrante)) / (Stock_Actual + Cantidad_Entrante)
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
```

---

## 6. CÓMO PRUEBAN SU TRABAJO DE FORMA DESACOPLADA
En DBeaver ejecuten una consulta para ver cómo cambian el stock y el CPP tras registrar una compra simulada:
```sql
SELECT p.sku, p.name, p.cost_price, sq.quantity_on_hand 
FROM products p
JOIN stock_quants sq ON sq.product_id = p.id
WHERE p.sku = 'CEM-001';
```

---

## 7. CHECKLIST PARA SUSTENTAR AL PROFESOR ANDERSON
Cuando el profesor se acerque a su puesto, deben mostrarle en menos de 60 segundos:
- [ ] La tabla `stock_moves` mostrando movimientos inmutables con stock anterior y stock nuevo calculados con precisión.
- [ ] Demostrar el recálculo matemático del Costo Promedio Ponderado al ingresar un producto a un precio mayor que el existente.
