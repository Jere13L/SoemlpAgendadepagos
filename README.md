# SOEMLP · FESIMUBO — Agenda de Pagos y Recordatorios

Aplicación web local para la gestión administrativa de **SOEMLP · FESIMUBO**.

## Funcionalidades
- **Agenda de Pagos**: Seguimiento mensual y semanal de **Seguro** (cupón de pago), **Agua** (remito/factura), **Alquiler** (liquidación), **Luz** (factura por NIS) y **Telecentro** (factura mensual).
- **Lector Inteligente de Comprobantes**: Lectura automática de PDFs (`PDF.js`), imágenes (`Tesseract.js` OCR) y texto de correos para extraer 1° y 2° vencimiento, importes, NIS, póliza, remito, CUIT, CAE, CBU/Alias y alertas.
- **Recordatorios Mensuales**: Checklist mes a mes para **RAFAM**, **Personas en comisión**, **Créditos**, **Altas y bajas de afiliados** y **Cuponera / envío de listados**, con notas y progreso mensual.
- **Persistencia y Respaldo**: Almacenamiento local en `IndexedDB` con exportación e importación de respaldos en `.json`.

## Uso rápido
- **En Windows (local)**: hacé doble clic en `iniciar_web.bat` para abrir `http://localhost:8765/`.
- **En GitHub Pages**: al ser 100% estática (`index.html`, `css/`, `js/`), también funciona publicada directamente en GitHub Pages.
