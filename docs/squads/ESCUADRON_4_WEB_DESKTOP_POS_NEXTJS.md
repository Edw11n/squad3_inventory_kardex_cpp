# GUÍA INDIVIDUAL DE TRABAJO: ESCUADRÓN 4
## WEB DESKTOP ADMIN & HIGH-SPEED POS (NEXT.JS 15)
### DIPLOMADO DE OPCIÓN DE GRADO EN DESARROLLO DE SOFTWARE 4.0 (MÓDULOS 4 Y 5)
**Institución Universitaria del Putumayo - UniPutumayo (Sede Mocoa)**  
**Facultad de Tecnologías de la Información y la Comunicación**  
**Programa:** Tecnología en Desarrollo de Software (VI Semestre)  
**Docente Titular y Arquitecto Principal:** Anderson Stiven Moncayo Bermeo  
**Espacio de Trabajo:** Sala de Cómputo 121  


## 0. REPOSITORIO CENTRAL OFICIAL DEL PROYECTO
Todos los integrantes del escuadrón deben clonar el repositorio central en GitHub y crear su rama de trabajo:

```bash
# 1. Clonar el repositorio oficial
git clone https://github.com/AndersonMoncayo/saas-contable-uniputumayo.git
cd saas-contable-uniputumayo

# 2. Configurar variables e instalar dependencias
cp .env.example .env
pnpm install

# 3. Iniciar infraestructura de base de datos y cache
docker compose up -d

# 4. Crear la rama oficial de su escuadron (NUNCA hacer commits en main)
git checkout -b squad-4/feature-nombre-modulo
```

---

## 1. MISIÓN DE SU ESCUADRÓN
Ustedes construyen el mostrador de ventas donde interactúan los cajeros. Su responsabilidad es desarrollar una interfaz web en Next.js 15 App Router que permita liquidar una venta completa en **menos de 10 segundos utilizando únicamente el teclado**, sin tocar el mouse, con números tabulares monoespaciados y renderizado fluido a 60 FPS gestionado por Zustand. No esperan al backend: usan el Mock Server desde el minuto 1.

---

## 2. ESTRUCTURA INTERNA DE SUS 4 INTEGRANTES (SCRUM AUTÓNOMO)
* **Integrante 1 (Squad Lead & Scrum Master):** Levanta el Mock Server de Prism en el puerto 3001, coordina los contratos DTO con el backend y modera el Daily de 5 minutos.
* **Integrante 2 (Zustand & Keyboard Specialist):** Codifica la tienda en memoria (`usePosStore.ts`) y el hook de escucha global de eventos de teclado (`usePosKeyboardShortcuts.ts`).
* **Integrante 3 (UI, Layout & Tabular Design Specialist):** Diseña el croquis del mostrador con Tailwind CSS, números tabulares (`font-mono tabular-nums`) y los 4 estados de la interfaz (Skeleton, Error Boundary, Empty State y Data Stream).
* **Integrante 4 (QA & Ergonomics Specialist):** Cronometra la velocidad de interacción del cajero para verificar que el flujo completo de cobro se complete en menos de 10 segundos.

---

## 3. SUS DEPENDENCIAS TÉCNICAS
* **Qué necesitan de los demás:**
  * El paquete `@saas/contracts` para importar `CheckoutPosDto` y `CartItemDto`.
  * El archivo `openapi.yaml` para levantar el servidor de pruebas con Prism.
* **Qué le entregan a los demás:**
  * La aplicación web que consume la API de NestJS cuando llegue el momento de la integración.

---

## 4. ESTRUCTURA DE ARCHIVOS DE SU CÓDIGO
Su código vive en `apps/web/`:

```
apps/web/
├── src/
│   ├── app/
│   │   └── (dashboard)/
│   │       ├── pos/page.tsx               <-- Mostrador POS por teclado
│   │       ├── credits/page.tsx           <-- Pantalla de fiados y cartera
│   │       └── inventory/page.tsx         <-- Catálogo y bodegas
│   ├── stores/
│   │   └── usePosStore.ts                 <-- Estado en memoria a 60 FPS
│   └── hooks/
│       └── usePosKeyboardShortcuts.ts     <-- Atajos globales [F2], [F4], [F9]
└── .env.local                             <-- Configuración de URL de la API
```

---

## 5. CÓDIGO DE PRODUCCIÓN LISTO PARA IMPLEMENTAR

### 1. Almacén de Estado POS en Memoria con Zustand
```typescript
// apps/web/src/stores/usePosStore.ts
import { create } from 'zustand';

export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

export interface CustomerData {
  id: string;
  documentNumber: string;
  name: string;
  creditLimit: number;
  currentDebt: number;
}

interface PosStoreState {
  cart: CartItem[];
  customer: CustomerData | null;
  paymentMethod: 'EFECTIVO' | 'TRANSFERENCIA_NEQUI_DAVIPLATA' | 'CREDITO_FIADO';
  cashTendered: number;
  isCheckoutOpen: boolean;
  addToCart: (product: any, quantity?: number) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  setCustomer: (customer: CustomerData | null) => void;
  setPaymentMethod: (method: 'EFECTIVO' | 'TRANSFERENCIA_NEQUI_DAVIPLATA' | 'CREDITO_FIADO') => void;
  setCashTendered: (amount: number) => void;
  setIsCheckoutOpen: (open: boolean) => void;
  getSubtotal: () => number;
  getTaxTotal: () => number;
  getGrandTotal: () => number;
  getChangeDue: () => number;
}

export const usePosStore = create<PosStoreState>((set, get) => ({
  cart: [],
  customer: null,
  paymentMethod: 'EFECTIVO',
  cashTendered: 0,
  isCheckoutOpen: false,

  addToCart: (product, quantity = 1) => {
    const { cart } = get();
    const existingIndex = cart.findIndex((i) => i.productId === product.id);

    if (existingIndex > -1) {
      const newCart = [...cart];
      const newQty = newCart[existingIndex].quantity + quantity;
      const subtotal = newQty * newCart[existingIndex].unitPrice;
      const taxAmount = subtotal * newCart[existingIndex].taxRate;

      newCart[existingIndex] = {
        ...newCart[existingIndex],
        quantity: newQty,
        subtotal,
        taxAmount,
        total: subtotal + taxAmount,
      };
      set({ cart: newCart });
    } else {
      const subtotal = quantity * product.salePrice;
      const taxAmount = subtotal * (product.taxRate || 0.19);
      const newItem: CartItem = {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unitOfMeasure: product.unitOfMeasure,
        quantity,
        unitPrice: product.salePrice,
        taxRate: product.taxRate || 0.19,
        subtotal,
        taxAmount,
        total: subtotal + taxAmount,
      };
      set({ cart: [...cart, newItem] });
    }
  },

  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeFromCart(productId);
      return;
    }
    const newCart = get().cart.map((item) => {
      if (item.productId === productId) {
        const subtotal = quantity * item.unitPrice;
        const taxAmount = subtotal * item.taxRate;
        return { ...item, quantity, subtotal, taxAmount, total: subtotal + taxAmount };
      }
      return item;
    });
    set({ cart: newCart });
  },

  removeFromCart: (productId) => set({ cart: get().cart.filter((i) => i.productId !== productId) }),
  clearCart: () => set({ cart: [], cashTendered: 0, isCheckoutOpen: false }),
  setCustomer: (customer) => set({ customer }),
  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
  setCashTendered: (cashTendered) => set({ cashTendered }),
  setIsCheckoutOpen: (isCheckoutOpen) => set({ isCheckoutOpen }),

  getSubtotal: () => get().cart.reduce((sum, item) => sum + item.subtotal, 0),
  getTaxTotal: () => get().cart.reduce((sum, item) => sum + item.taxAmount, 0),
  getGrandTotal: () => get().getSubtotal() + get().getTaxTotal(),
  getChangeDue: () => {
    const diff = get().cashTendered - get().getGrandTotal();
    return diff > 0 ? diff : 0;
  },
}));
```

### 2. Hook de Atajos de Teclado Globales
```typescript
// apps/web/src/hooks/usePosKeyboardShortcuts.ts
import { useEffect } from 'react';
import { usePosStore } from '../stores/usePosStore';

export function usePosKeyboardShortcuts(
  onSearchFocus: () => void,
  onCustomerOpen: () => void,
  onCheckoutSubmit: () => void
) {
  const store = usePosStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'F2':
          event.preventDefault();
          onSearchFocus();
          break;
        case 'F4':
          event.preventDefault();
          onCustomerOpen();
          break;
        case 'F9':
          event.preventDefault();
          if (store.cart.length > 0) store.setIsCheckoutOpen(true);
          break;
        case 'F10':
          event.preventDefault();
          if (store.cart.length > 0) {
            store.setPaymentMethod('EFECTIVO');
            store.setCashTendered(store.getGrandTotal());
            onCheckoutSubmit();
          }
          break;
        case 'F12':
          event.preventDefault();
          if (store.cart.length > 0) {
            store.setPaymentMethod('CREDITO_FIADO');
            store.setIsCheckoutOpen(true);
          }
          break;
        case 'Escape':
          event.preventDefault();
          if (store.isCheckoutOpen) store.setIsCheckoutOpen(false);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store, onSearchFocus, onCustomerOpen, onCheckoutSubmit]);
}
```

---

## 6. CÓMO PRUEBAN SU TRABAJO DE FORMA DESACOPLADA (SIN ESPERAR AL BACKEND)
1. Abran una terminal y ejecuten el Mock Server:
   ```b`ash
   npx @stoplight/prism-cli mock openapi.yaml -p 3001
   ```
2. En `apps/web/.env.local` configuren:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```
3. Inicien Next.js:
   ```b`ash
   pnpm --filter web dev
   ```
4. Abran `http://localhost:4000/pos`. Presionen `F2`, busquen un producto sintético devuelto por Prism, presionen `F9` para cobrar, ingresen el efectivo y presionen `Enter`. La orden debe completarse con éxito.

---

## 7. CHECKLIST PARA SUSTENTAR AL PROFESOR ANDERSON
Cuando el profesor se acerque a su puesto, deben mostrarle en menos de 60 segundos:
- [ ] Liquidar una venta completa operando 100% por teclado (`F2` para buscar, `F4` cliente, `F9` cobrar, `Enter` liquidar).
- [ ] Mostrar que los precios, subtotales y devueltas usan tipografía tabular monoespaciada (`font-mono tabular-nums`).

