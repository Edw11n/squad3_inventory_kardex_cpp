# GUÍA INDIVIDUAL DE TRABAJO: ESCUADRÓN 5
## MOBILE POS NATIVE FLUTTER (ANDROID & IOS) & OFFLINE-FIRST
### DIPLOMADO DE OPCIÓN DE GRADO EN DESARROLLO DE SOFTWARE 4.0 (MÓDULOS 4 Y 5)
**Institución Universitaria del Putumayo - UniPutumayo (Sede Mocoa)**  
**Facultad de Tecnologías de la Información y la Comunicación**  
**Programa:** Tecnología en Desarrollo de Software (VI Semestre)  
**Docente Titular y Arquitecto Principal:** Anderson Stiven Moncayo Bermeo  
**Espacio de Trabajo:** Sala de Cómputo 121  

---

## 1. MISIÓN DE SU ESCUADRÓN
Ustedes desarrollan la aplicación móvil para ventas y cobro de abonos en ruta. Su responsabilidad es garantizar que la aplicación funcione **al 100% sin conexión a internet (Offline-First)** mediante la base de datos embebida **Isar DB**, capture códigos de barra lineales estándar (EAN-13/Code-128) con la cámara nativa (sin OCR ni IA) y sincronice las ventas diferidas mediante una cola idempotente (`SyncQueue`) sin duplicar comprobantes ni existencias.

---

## 2. ESTRUCTURA INTERNA DE SUS 4 INTEGRANTES (SCRUM AUTÓNOMO)
* **Integrante 1 (Squad Lead & Scrum Master):** Conecta la app al Mock Server de Prism (`http://10.0.2.2:3001` en emulador o IP de la sala en celular físico) y modera el Daily de 5 minutos.
* **Integrante 2 (Offline & Isar DB Specialist):** Modela las colecciones locales en Isar y codifica el worker de sincronización en segundo plano (`SyncQueueWorker`).
* **Integrante 3 (Hardware & Camera Specialist):** Integra el lector de códigos de barras geométrico con `mobile_scanner` y el generador de recibos para WhatsApp.
* **Integrante 4 (QA & Network Testing Specialist):** Ejecuta pruebas con Modo Avión para certificar que ninguna orden offline se pierda o se duplique al recuperar la conectividad.

---

## 3. SUS DEPENDENCIAS TÉCNICAS
* **Qué necesitan de los demás:**
  * El paquete `@saas/contracts` para coincidir exactamente con los nombres de campos del checkout.
  * El Mock Server de Prism (puerto 3001) para probar sin backend.
* **Qué le entregan a los demás:**
  * Las peticiones de checkout sincronizadas con cabecera `X-Idempotency-Key` y los abonos de cartera en ruta.

---

## 4. ESTRUCTURA DE ARCHIVOS DE SU CÓDIGO
Su código vive en `apps/mobile/`:

```
apps/mobile/lib/
├── core/
│   ├── storage/isar_models.dart           <-- Modelos de base de datos local Isar
│   └── sync/sync_queue_worker.dart        <-- Cola de sincronizacion idempotente
└── features/
    ├── pos/presentation/controllers/     <-- Providers de Riverpod para POS
    └── scanner/presentation/              <-- Lector de barras con camara (Sin OCR)
```

---

## 5. CÓDIGO DE PRODUCCIÓN LISTO PARA IMPLEMENTAR

### 1. Modelos Isar Database para Soporte Offline
```dart
// apps/mobile/lib/core/storage/isar_models.dart
import 'package:isar/isar.dart';

part 'isar_models.g.dart';

@collection
class LocalProduct {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String serverId;

  late String sku;
  String? barcode;
  late String name;
  late String unitOfMeasure;
  late double salePrice;
  late double taxRate;
  late double stockOnHand;
}

@collection
class SyncTask {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String idempotencyKey;

  late String endpoint;
  late String method;
  late String payloadJson;
  late DateTime createdAt;

  @Index()
  late String status; // 'PENDING', 'SYNCING', 'FAILED', 'COMPLETED'

  int retryCount = 0;
  String? lastError;
}
```

### 2. Worker de Sincronización en Segundo Plano con Idempotencia
```dart
// apps/mobile/lib/core/sync/sync_queue_worker.dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:isar/isar.dart';
import 'isar_models.dart';

class SyncQueueWorker {
  final Isar isar;
  final String apiBaseUrl;
  final String Function() getAuthToken;
  bool _isProcessing = false;

  SyncQueueWorker({
    required this.isar,
    required this.apiBaseUrl,
    required this.getAuthToken,
  });

  Future<void> enqueueTask({
    required String endpoint,
    required String method,
    required Map<String, dynamic> payload,
    required String idempotencyKey,
  }) async {
    final task = SyncTask()
      ..idempotencyKey = idempotencyKey
      ..endpoint = endpoint
      ..method = method
      ..payloadJson = jsonEncode(payload)
      ..createdAt = DateTime.now()
      ..status = 'PENDING'
      ..retryCount = 0;

    await isar.writeTxn(() async {
      await isar.syncTasks.put(task);
    });

    processPendingTasks();
  }

  Future<void> processPendingTasks() async {
    if (_isProcessing) return;
    _isProcessing = true;

    try {
      final pendingTasks = await isar.syncTasks
          .filter()
          .statusEqualTo('PENDING')
          .sortByCreatedAt()
          .findAll();

      for (final task in pendingTasks) {
        task.status = 'SYNCING';
        await isar.writeTxn(() async => await isar.syncTasks.put(task));

        try {
          final response = await http.post(
            Uri.parse('$apiBaseUrl${task.endpoint}'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ${getAuthToken()}',
              'X-Idempotency-Key': task.idempotencyKey,
            },
            body: task.payloadJson,
          );

          if (response.statusCode >= 200 && response.statusCode < 300) {
            task.status = 'COMPLETED';
            await isar.writeTxn(() async => await isar.syncTasks.put(task));
          } else if (response.statusCode == 409) {
            // Ya procesada en el servidor (Idempotente)
            task.status = 'COMPLETED';
            await isar.writeTxn(() async => await isar.syncTasks.put(task));
          } else {
            task.status = 'FAILED';
            task.retryCount++;
            task.lastError = 'HTTP ${response.statusCode}: ${response.body}';
            await isar.writeTxn(() async => await isar.syncTasks.put(task));
          }
        } catch (e) {
          task.status = 'PENDING'; // Reintenta al recuperar la conectividad
          task.retryCount++;
          task.lastError = e.toString();
          await isar.writeTxn(() async => await isar.syncTasks.put(task));
          break; // Detener si no hay conexion
        }
      }
    } finally {
      _isProcessing = false;
    }
  }
}
```

---

## 6. CÓMO PRUEBAN SU TRABAJO DE FORMA DESACOPLADA (SIN ESPERAR AL BACKEND)
1. Conecten su emulador a `http://10.0.2.2:3001` (donde corre el Mock Server de Prism).
2. Ejecuten la app:
   ```bash
   cd apps/mobile
   flutter pub get
   flutter run
   ```
3. **Prueba Offline Estricta:**
   * Activen el **Modo Avión** en el dispositivo.
   * Realicen una venta. La transacción debe guardarse en Isar DB local.
   * Desactiven el Modo Avión. Verifiquen que la consola muestre el envío automático al puerto 3001 con estado `COMPLETED`.

---

## 7. CHECKLIST PARA SUSTENTAR AL PROFESOR ANDERSON
Cuando el profesor se acerque a su puesto, deben mostrarle en menos de 60 segundos:
- [ ] Venta realizada en Modo Avión sin pantalla roja, persistida en Isar DB local.
- [ ] Reconexión a red con sincronización automática hacia la API mediante clave de idempotencia (`X-Idempotency-Key`).
