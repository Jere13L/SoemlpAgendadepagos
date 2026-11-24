/**
 * Capa de persistencia local en IndexedDB para SOEMLP · FESIMUBO
 * Guarda pagos, archivos adjuntos (PDF/imágenes), recordatorios, estados mensuales y actividad.
 */
window.SoemlpDB = (() => {
  const DB_NAME = 'soemlp_fesimubo_db';
  const DB_VERSION = 1;
  let dbInstance = null;

  const DEFAULT_TAREAS = [
    {
      id: 't-rafam',
      titulo: 'Enviar RAFAM (Planilla de afiliados)',
      descripcion: 'Preparar y enviar la planilla actualizada de afiliados correspondiente a RAFAM.',
      diaLimite: 5,
      canal: 'Correo / Sistema',
      prioridad: 'alta',
      recurrente: true,
      mesUnico: null,
      active: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 't-comision',
      titulo: 'Personas en comisión',
      descripcion: 'Imprimir y entregar la documentación / listado de personas en comisión.',
      diaLimite: 8,
      canal: 'Impreso y entregar',
      prioridad: 'alta',
      recurrente: true,
      mesUnico: null,
      active: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 't-creditos',
      titulo: 'Créditos — Enviar descuentos a Personal',
      descripcion: 'Consolidar y enviar a la oficina de Personal los descuentos de créditos del mes.',
      diaLimite: 10,
      canal: 'Personal / RRHH',
      prioridad: 'alta',
      recurrente: true,
      mesUnico: null,
      active: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 't-altas-bajas',
      titulo: 'Enviar altas y bajas de afiliados',
      descripcion: 'Remitir el detalle mensual de altas y bajas de afiliados.',
      diaLimite: 12,
      canal: 'Correo / Sistema',
      prioridad: 'alta',
      recurrente: true,
      mesUnico: null,
      active: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 't-cuponera',
      titulo: 'Cuponera y envío de listados',
      descripcion: 'Organizar la cuponera y coordinar cómo se envían los listados del período.',
      diaLimite: 15,
      canal: 'WhatsApp / Listado',
      prioridad: 'media',
      recurrente: true,
      mesUnico: null,
      active: true,
      createdAt: new Date().toISOString()
    }
  ];

  function open() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pagos')) {
          const store = db.createObjectStore('pagos', { keyPath: 'id' });
          store.createIndex('periodo', 'periodo', { unique: false });
          store.createIndex('categoria', 'categoria', { unique: false });
        }
        if (!db.objectStoreNames.contains('tareas')) {
          db.createObjectStore('tareas', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('tareas_estado')) {
          const st = db.createObjectStore('tareas_estado', { keyPath: 'key' });
          st.createIndex('periodo', 'periodo', { unique: false });
        }
        if (!db.objectStoreNames.contains('actividad')) {
          db.createObjectStore('actividad', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function tx(storeName, mode = 'readonly') {
    return open().then((db) => db.transaction(storeName, mode).objectStore(storeName));
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function initSeed() {
    const store = await tx('tareas', 'readonly');
    const existing = await reqToPromise(store.getAll());
    if (existing.length === 0) {
      const writeStore = await tx('tareas', 'readwrite');
      for (const t of DEFAULT_TAREAS) {
        writeStore.put(t);
      }
      await logActividad('sistema', 'Se inicializaron los 5 recordatorios mensuales de SOEMLP · FESIMUBO.');
    }
  }

  async function getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.getAll());
  }

  async function put(storeName, item) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.put(item));
  }

  async function remove(storeName, key) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.delete(key));
  }

  async function logActividad(tipo, mensaje) {
    const store = await tx('actividad', 'readwrite');
    return reqToPromise(
      store.add({
        fecha: new Date().toISOString(),
        tipo,
        mensaje
      })
    );
  }

  async function exportAll() {
    const [pagos, tareas, tareas_estado, actividad] = await Promise.all([
      getAll('pagos'),
      getAll('tareas'),
      getAll('tareas_estado'),
      getAll('actividad')
    ]);
    return {
      app: 'SOEMLP_FESIMUBO_AGENDA',
      version: 1,
      exportedAt: new Date().toISOString(),
      pagos,
      tareas,
      tareas_estado,
      actividad
    };
  }

  async function importAll(payload) {
    if (!payload || payload.app !== 'SOEMLP_FESIMUBO_AGENDA') {
      throw new Error('El archivo no corresponde a un respaldo válido de SOEMLP · FESIMUBO.');
    }
    const db = await open();
    const stores = ['pagos', 'tareas', 'tareas_estado', 'actividad'];
    const transaction = db.transaction(stores, 'readwrite');
    for (const s of stores) {
      transaction.objectStore(s).clear();
    }
    (payload.pagos || []).forEach((item) => transaction.objectStore('pagos').put(item));
    (payload.tareas || []).forEach((item) => transaction.objectStore('tareas').put(item));
    (payload.tareas_estado || []).forEach((item) => transaction.objectStore('tareas_estado').put(item));
    (payload.actividad || []).forEach((item) => {
      const copy = { ...item };
      delete copy.id;
      transaction.objectStore('actividad').add(copy);
    });
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  return {
    initSeed,
    getAll,
    put,
    remove,
    logActividad,
    exportAll,
    importAll
  };
})();
