(() => {
  const DB = window.SoemlpDB;
  const Parser = window.SoemlpParser;

  const SERVICES = [
    { key: 'Seguro', label: 'Seguro', icon: '🛡️', desc: 'Cupón de pago' },
    { key: 'Agua', label: 'Agua', icon: '💧', desc: 'Remito / factura semanal y mensual' },
    { key: 'Alquiler', label: 'Alquiler', icon: '🏢', desc: 'Liquidación mensual' },
    { key: 'Luz', label: 'Luz', icon: '⚡', desc: 'Factura por NIS (correo)' },
    { key: 'Telecentro', label: 'Telecentro', icon: '🌐', desc: 'Factura mensual (correo)' }
  ];

  const state = {
    activeMonth: new Date().toISOString().slice(0, 7),
    activeView: 'dashboard',
    searchQuery: '',
    pagosCatFilter: 'all',
    pagosStatusFilter: 'all',
    tareasStatusFilter: 'all',
    pagos: [],
    tareas: [],
    tareasEstado: [],
    actividad: [],
    currentDraftFile: null,      // { nombre, tipo, dataUrl, rawText }
    currentDraftComprobante: null // { nombre, tipo, dataUrl }
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Helpers
  function uid(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function formatMoney(val) {
    const num = parseFloat(val);
    if (!Number.isFinite(num)) return '—';
    return '$ ' + num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDateAR(isoDate) {
    if (!isoDate) return '—';
    const [y, m, d] = isoDate.split('-');
    if (!y || !m || !d) return isoDate;
    return `${d}/${m}/${y}`;
  }

  function formatMonthLabel(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    const names = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    return `${names[parseInt(m, 10) - 1] || m} ${y}`;
  }

  function todayISO() {
    const now = new Date();
    const off = now.getTimezoneOffset();
    const local = new Date(now.getTime() - off * 60000);
    return local.toISOString().slice(0, 10);
  }

  function daysDiffFromToday(isoDate) {
    if (!isoDate) return null;
    const t = new Date(todayISO() + 'T00:00:00');
    const d = new Date(isoDate + 'T00:00:00');
    return Math.round((d - t) / 86400000);
  }

  function getEffectivePagoStatus(pago) {
    if (pago.estado === 'pagado') return 'pagado';
    if (pago.vencimiento1) {
      const diff = daysDiffFromToday(pago.vencimiento1);
      if (diff !== null && diff < 0) return 'vencido';
    }
    return 'pendiente';
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function toast(msg, type = 'success') {
    const container = $('#toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Data Loading
  async function reloadData() {
    const [pagos, tareas, tareasEstado, actividad] = await Promise.all([
      DB.getAll('pagos'),
      DB.getAll('tareas'),
      DB.getAll('tareas_estado'),
      DB.getAll('actividad')
    ]);
    state.pagos = pagos.sort((a, b) => (a.vencimiento1 || '9999').localeCompare(b.vencimiento1 || '9999'));
    state.tareas = tareas.filter((t) => t.active !== false).sort((a, b) => (a.diaLimite || 99) - (b.diaLimite || 99));
    state.tareasEstado = tareasEstado;
    state.actividad = actividad.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 40);
    renderAll();
  }

  function getTareasForMonth(ym) {
    return state.tareas
      .filter((t) => t.recurrente || t.mesUnico === ym)
      .map((t) => {
        const key = `${ym}__${t.id}`;
        const st = state.tareasEstado.find((e) => e.key === key);
        return {
          ...t,
          estado: st ? st.estado : 'pendiente',
          fechaHecho: st ? st.fechaHecho : null,
          notaMensual: st ? st.nota || '' : ''
        };
      });
  }

  function getPagosForMonth(ym) {
    return state.pagos.filter((p) => p.periodo === ym);
  }

  // Navigation
  function switchView(viewName) {
    state.activeView = viewName;
    $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === viewName));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${viewName}`));

    const titles = {
      dashboard: ['Resumen del Mes', `Panorama de ${formatMonthLabel(state.activeMonth)} · SOEMLP FESIMUBO`],
      pagos: ['Agenda de Pagos', `Facturas, cupones, liquidaciones y remitos de ${formatMonthLabel(state.activeMonth)}`],
      recordatorios: ['Recordatorios Mensuales', `Control de envíos y entregas de ${formatMonthLabel(state.activeMonth)}`],
      respaldo: ['Historial y Respaldo', 'Copia de seguridad local, cumplimiento anual y actividad']
    };
    const [t, sub] = titles[viewName] || ['', ''];
    $('#view-title').textContent = t;
    $('#view-subtitle').textContent = sub;
  }

  function renderAll() {
    const monthPagos = getPagosForMonth(state.activeMonth);
    const monthTareas = getTareasForMonth(state.activeMonth);

    // Badges en sidebar
    const pagosPend = monthPagos.filter((p) => getEffectivePagoStatus(p) !== 'pagado').length;
    const tareasPend = monthTareas.filter((t) => t.estado !== 'hecho').length;

    const bPagos = $('#badge-pagos-pendientes');
    bPagos.textContent = pagosPend;
    bPagos.classList.toggle('has-pending', pagosPend > 0);

    const bTareas = $('#badge-tareas-pendientes');
    bTareas.textContent = tareasPend;
    bTareas.classList.toggle('has-pending', tareasPend > 0);

    // Actualizar subtítulo por cambio de mes
    switchView(state.activeView);

    renderDashboard(monthPagos, monthTareas);
    renderPagos(monthPagos);
    renderRecordatorios(monthTareas);
    renderRespaldo();
  }

  // Render: Dashboard
  function renderDashboard(monthPagos, monthTareas) {
    const totalPendiente = monthPagos
      .filter((p) => p.estado !== 'pagado')
      .reduce((acc, p) => acc + (parseFloat(p.monto1) || 0), 0);
    const totalPagado = monthPagos
      .filter((p) => p.estado === 'pagado')
      .reduce((acc, p) => acc + (parseFloat(p.monto1) || 0), 0);
    const vencidos = monthPagos.filter((p) => getEffectivePagoStatus(p) === 'vencido').length;
    const tareasHechas = monthTareas.filter((t) => t.estado === 'hecho').length;

    $('#dashboard-kpis').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Pendiente de Pago</div>
        <div class="kpi-value">${formatMoney(totalPendiente)}</div>
        <div class="kpi-sub">${monthPagos.filter((p) => p.estado !== 'pagado').length} comprobantes por abonar</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Pagado en el Período</div>
        <div class="kpi-value" style="color: var(--success)">${formatMoney(totalPagado)}</div>
        <div class="kpi-sub">${monthPagos.filter((p) => p.estado === 'pagado').length} comprobantes abonados</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Vencidos / Urgentes</div>
        <div class="kpi-value" style="color: ${vencidos > 0 ? 'var(--danger)' : 'var(--text)'}">${vencidos}</div>
        <div class="kpi-sub">${vencidos > 0 ? 'Requieren atención inmediata' : 'Sin facturas vencidas'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Recordatorios del Mes</div>
        <div class="kpi-value">${tareasHechas} / ${monthTareas.length}</div>
        <div class="kpi-sub">${monthTareas.length - tareasHechas} pendientes de realizar</div>
      </div>
    `;

    const pagosUrgentes = monthPagos.filter((p) => p.estado !== 'pagado').slice(0, 6);
    const pagosListEl = $('#dashboard-pagos-list');
    if (pagosUrgentes.length === 0) {
      pagosListEl.innerHTML = `<div class="empty-state">No hay pagos pendientes cargados para ${formatMonthLabel(state.activeMonth)}.</div>`;
    } else {
      pagosListEl.innerHTML = pagosUrgentes
        .map((p) => {
          const eff = getEffectivePagoStatus(p);
          const pillClass = eff === 'vencido' ? 'pill-danger' : 'pill-warning';
          return `
            <div class="compact-item">
              <div class="compact-item-main">
                <div class="compact-item-title">${escapeHtml(p.titulo)}</div>
                <div class="compact-item-sub">
                  ${escapeHtml(p.categoria)} · Vto: ${formatDateAR(p.vencimiento1)} · <strong>${formatMoney(p.monto1)}</strong>
                </div>
              </div>
              <span class="pill ${pillClass}">${eff === 'vencido' ? 'Vencido' : 'Pendiente'}</span>
              <button type="button" class="btn btn-success btn-xs" data-toggle-pago="${p.id}">Marcar Pagado</button>
            </div>
          `;
        })
        .join('');
    }

    const tareasListEl = $('#dashboard-tareas-list');
    if (monthTareas.length === 0) {
      tareasListEl.innerHTML = `<div class="empty-state">No hay recordatorios configurados.</div>`;
    } else {
      tareasListEl.innerHTML = monthTareas
        .map((t) => {
          const done = t.estado === 'hecho';
          return `
            <div class="compact-item">
              <div class="compact-item-main">
                <div class="compact-item-title" style="${done ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${escapeHtml(t.titulo)}</div>
                <div class="compact-item-sub">Día sugerido: ${t.diaLimite || '—'} · ${escapeHtml(t.canal)}</div>
              </div>
              <button type="button" class="btn ${done ? 'btn-secondary' : 'btn-primary'} btn-xs" data-quick-tarea="${t.id}">
                ${done ? '✅ Hecho' : 'Marcar Hecho'}
              </button>
            </div>
          `;
        })
        .join('');
    }
  }

  // Render: Agenda de Pagos
  function renderPagos(monthPagos) {
    // 5 Tarjetas de servicios principales
    $('#services-overview-grid').innerHTML = SERVICES.map((srv) => {
      const items = monthPagos.filter((p) => p.categoria === srv.key);
      const pend = items.filter((p) => p.estado !== 'pagado');
      const totalPend = pend.reduce((a, b) => a + (parseFloat(b.monto1) || 0), 0);
      const statusBadge =
        items.length === 0
          ? `<span class="pill pill-neutral">Sin cargar</span>`
          : pend.length === 0
          ? `<span class="pill pill-success">Al día (${items.length})</span>`
          : `<span class="pill pill-warning">${pend.length} pend.</span>`;

      return `
        <div class="service-card">
          <div class="service-card-top">
            <span>${srv.icon} ${srv.label}</span>
            ${statusBadge}
          </div>
          <div class="service-card-meta">${srv.desc}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:6px;">
            <strong style="font-size:13.5px;">${pend.length > 0 ? formatMoney(totalPend) : items.length > 0 ? 'Pagado' : '—'}</strong>
            <button type="button" class="btn btn-secondary btn-xs" data-new-srv="${srv.key}">+ Cargar</button>
          </div>
        </div>
      `;
    }).join('');

    // Filtros + búsqueda
    const q = state.searchQuery.trim().toLowerCase();
    const filtered = monthPagos.filter((p) => {
      if (state.pagosCatFilter !== 'all' && p.categoria !== state.pagosCatFilter) return false;
      const eff = getEffectivePagoStatus(p);
      if (state.pagosStatusFilter !== 'all' && eff !== state.pagosStatusFilter) return false;
      if (q) {
        const hay = `${p.titulo} ${p.categoria} ${p.identificador} ${p.datosExtra} ${p.notas} ${p.monto1}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    $('#pagos-count-label').textContent = `${filtered.length} registro(s)`;
    const container = $('#pagos-table-container');

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          No se encontraron comprobantes para ${formatMonthLabel(state.activeMonth)} con los filtros actuales.<br/>
          Usá <strong>"+ Nuevo Registro / Subir Archivo"</strong> para cargar una factura, cupón o remito.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Concepto / Identificador</th>
            <th>Vencimientos</th>
            <th>Importe</th>
            <th>Estado</th>
            <th>Archivos</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${filtered
            .map((p) => {
              const eff = getEffectivePagoStatus(p);
              const diff = daysDiffFromToday(p.vencimiento1);
              let vtoHint = '';
              if (eff !== 'pagado' && diff !== null) {
                if (diff < 0) vtoHint = `<span class="pill pill-danger">Vencido hace ${Math.abs(diff)}d</span>`;
                else if (diff === 0) vtoHint = `<span class="pill pill-danger">Vence hoy</span>`;
                else if (diff <= 4) vtoHint = `<span class="pill pill-warning">En ${diff}d</span>`;
              }

              const statusPill =
                eff === 'pagado'
                  ? `<span class="pill pill-success">✅ Pagado${p.fechaPago ? ' · ' + formatDateAR(p.fechaPago) : ''}</span>`
                  : eff === 'vencido'
                  ? `<span class="pill pill-danger">⚠️ Vencido</span>`
                  : `<span class="pill pill-warning">⏳ Pendiente</span>`;

              return `
                <tr>
                  <td>
                    <strong>${escapeHtml(p.categoria)}</strong><br/>
                    <span class="muted">${escapeHtml(p.frecuencia || 'Mensual')}</span>
                  </td>
                  <td>
                    <strong>${escapeHtml(p.titulo)}</strong>
                    ${p.identificador ? `<div class="muted">${escapeHtml(p.identificador)}</div>` : ''}
                    ${p.datosExtra ? `<div class="muted" style="font-size:11.5px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(p.datosExtra)}">${escapeHtml(p.datosExtra)}</div>` : ''}
                  </td>
                  <td>
                    <div>1°: <strong>${formatDateAR(p.vencimiento1)}</strong> ${vtoHint}</div>
                    ${p.vencimiento2 ? `<div class="muted">2°: ${formatDateAR(p.vencimiento2)} (${formatMoney(p.monto2)})</div>` : ''}
                  </td>
                  <td><strong>${formatMoney(p.monto1)}</strong></td>
                  <td>${statusPill}</td>
                  <td>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;">
                      ${p.archivoDataUrl ? `<button type="button" class="btn btn-secondary btn-xs" data-view-file="${p.id}" data-kind="factura">📄 Factura</button>` : '<span class="muted">Sin archivo</span>'}
                      ${p.comprobanteDataUrl ? `<button type="button" class="btn btn-secondary btn-xs" data-view-file="${p.id}" data-kind="comprobante">🧾 Comprobante</button>` : ''}
                    </div>
                  </td>
                  <td>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;">
                      <button type="button" class="btn ${eff === 'pagado' ? 'btn-secondary' : 'btn-success'} btn-xs" data-toggle-pago="${p.id}">
                        ${eff === 'pagado' ? 'Reabrir' : 'Pagar'}
                      </button>
                      <button type="button" class="btn btn-secondary btn-xs" data-edit-pago="${p.id}">Editar</button>
                      <button type="button" class="btn btn-danger-ghost btn-xs" data-del-pago="${p.id}">✕</button>
                    </div>
                  </td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `;
  }

  // Render: Recordatorios Mensuales
  function renderRecordatorios(monthTareas) {
    const total = monthTareas.length;
    const hechos = monthTareas.filter((t) => t.estado === 'hecho').length;
    const pct = total > 0 ? Math.round((hechos / total) * 100) : 0;

    $('#tareas-progress-label').textContent = `${hechos} de ${total} completadas en ${formatMonthLabel(state.activeMonth)}`;
    $('#tareas-progress-pct').textContent = `${pct}%`;
    $('#tareas-progress-fill').style.width = `${pct}%`;

    const q = state.searchQuery.trim().toLowerCase();
    const filtered = monthTareas.filter((t) => {
      if (state.tareasStatusFilter !== 'all' && t.estado !== state.tareasStatusFilter) return false;
      if (q) {
        const hay = `${t.titulo} ${t.descripcion} ${t.canal} ${t.notaMensual}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const container = $('#tareas-list-container');
    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state">No hay recordatorios que coincidan con el filtro.</div>`;
      return;
    }

    const today = todayISO();
    container.innerHTML = filtered
      .map((t) => {
        const dueDate = `${state.activeMonth}-${String(t.diaLimite || 15).padStart(2, '0')}`;
        const isOverdue = t.estado !== 'hecho' && dueDate < today;
        const prioBadge =
          t.prioridad === 'alta'
            ? `<span class="pill pill-danger">Prioridad Alta</span>`
            : t.prioridad === 'media'
            ? `<span class="pill pill-warning">Media</span>`
            : `<span class="pill pill-neutral">Baja</span>`;

        return `
          <article class="task-card ${t.estado === 'hecho' ? 'is-done' : ''} ${isOverdue ? 'is-overdue' : ''}">
            <div class="task-card-header">
              <div>
                <div class="task-title">${escapeHtml(t.titulo)}</div>
                <div class="task-desc">${escapeHtml(t.descripcion || '')}</div>
              </div>
              ${prioBadge}
            </div>

            <div class="task-meta">
              <span class="pill pill-info">📅 Día ${t.diaLimite || '—'}</span>
              <span class="pill pill-neutral">📤 ${escapeHtml(t.canal)}</span>
              ${isOverdue ? `<span class="pill pill-danger">Atrasado</span>` : ''}
              ${t.fechaHecho ? `<span class="pill pill-success">Hecho el ${formatDateAR(t.fechaHecho)}</span>` : ''}
            </div>

            <div>
              <input
                type="text"
                class="input"
                style="font-size:12.5px;padding:6px 9px;"
                placeholder="Nota del mes (ej: enviado por mail, entregado a...)..."
                value="${escapeHtml(t.notaMensual)}"
                data-tarea-nota="${t.id}"
              />
            </div>

            <div class="task-actions">
              <select class="select-input" data-tarea-estado="${t.id}" style="font-size:12.5px;padding:5px 8px;">
                <option value="pendiente" ${t.estado === 'pendiente' ? 'selected' : ''}>⏳ Pendiente</option>
                <option value="en_proceso" ${t.estado === 'en_proceso' ? 'selected' : ''}>🔄 En proceso</option>
                <option value="hecho" ${t.estado === 'hecho' ? 'selected' : ''}>✅ Hecho / Enviado</option>
              </select>
              <div style="display:flex;gap:4px;">
                <button type="button" class="btn btn-secondary btn-xs" data-edit-tarea="${t.id}">Editar</button>
                <button type="button" class="btn btn-danger-ghost btn-xs" data-del-tarea="${t.id}">✕</button>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  // Render: Respaldo y Anual
  function renderRespaldo() {
    const year = state.activeMonth.slice(0, 4);
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const pMonth = getPagosForMonth(ym);
      const tMonth = getTareasForMonth(ym);
      const pDone = pMonth.filter((p) => p.estado === 'pagado').length;
      const tDone = tMonth.filter((t) => t.estado === 'hecho').length;
      if (pMonth.length > 0 || tDone > 0 || ym === state.activeMonth) {
        rows.push(`
          <tr>
            <td><strong>${formatMonthLabel(ym)}</strong></td>
            <td>${pDone} / ${pMonth.length} pagados</td>
            <td>${tDone} / ${tMonth.length} completados</td>
          </tr>
        `);
      }
    }

    $('#annual-summary-container').innerHTML = rows.length
      ? `<table class="data-table"><thead><tr><th>Período</th><th>Pagos</th><th>Recordatorios</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
      : `<div class="empty-state">Aún no hay movimientos registrados en ${year}.</div>`;

    const actEl = $('#activity-log-container');
    if (state.actividad.length === 0) {
      actEl.innerHTML = `<div class="empty-state">Sin actividad reciente.</div>`;
    } else {
      actEl.innerHTML = state.actividad
        .slice(0, 15)
        .map(
          (a) => `
          <div class="compact-item">
            <div class="compact-item-main">
              <div class="compact-item-title">${escapeHtml(a.mensaje)}</div>
              <div class="compact-item-sub">${new Date(a.fecha).toLocaleString('es-AR')}</div>
            </div>
            <span class="pill pill-neutral">${escapeHtml(a.tipo)}</span>
          </div>
        `
        )
        .join('');
    }
  }

  // Modal helpers
  function openModal(id) {
    $(`#${id}`).classList.add('open');
    $(`#${id}`).setAttribute('aria-hidden', 'false');
  }

  function closeModal(id) {
    $(`#${id}`).classList.remove('open');
    $(`#${id}`).setAttribute('aria-hidden', 'true');
  }

  function resetPagoModal(presetCategoria = 'Seguro') {
    $('#modal-pago-title').textContent = 'Cargar y Leer Comprobante';
    $('#form-pago').reset();
    $('#pago-id').value = '';
    $('#pago-categoria').value = presetCategoria;
    $('#pago-periodo').value = state.activeMonth;
    $('#pago-estado').value = 'pendiente';
    $('#pago-comprobante-name').textContent = '';
    $('#file-preview-box').classList.add('hidden');
    $('#extraction-alerts').classList.add('hidden');
    $('#raw-text-panel').classList.add('hidden');
    $('#ocr-status-bar').classList.add('hidden');
    $('#preview-media').innerHTML = '';
    $('#raw-extracted-text').value = '';
    state.currentDraftFile = null;
    state.currentDraftComprobante = null;
  }

  function renderFilePreview(nombre, tipo, dataUrl) {
    if (!dataUrl) return;
    $('#file-preview-box').classList.remove('hidden');
    $('#preview-filename').textContent = nombre || 'Archivo adjunto';
    const media = $('#preview-media');
    if ((tipo && tipo.startsWith('image/')) || /^data:image\//.test(dataUrl)) {
      media.innerHTML = `<img src="${dataUrl}" alt="Vista previa del comprobante" />`;
    } else if (tipo === 'application/pdf' || /^data:application\/pdf/.test(dataUrl)) {
      media.innerHTML = `<embed src="${dataUrl}" type="application/pdf" />`;
    } else {
      media.innerHTML = `<div class="muted" style="padding:16px;">Archivo de texto cargado. Revisá el texto extraído debajo.</div>`;
    }
  }

  function applyParsedFields(parsed) {
    if (!parsed) return;
    if (parsed.categoria) $('#pago-categoria').value = parsed.categoria;
    if (parsed.frecuencia) $('#pago-frecuencia').value = parsed.frecuencia;
    if (parsed.titulo) $('#pago-titulo').value = parsed.titulo;
    if (parsed.periodo) $('#pago-periodo').value = parsed.periodo;
    if (parsed.identificador) $('#pago-identificador').value = parsed.identificador;
    if (parsed.vencimiento1) $('#pago-vencimiento1').value = parsed.vencimiento1;
    if (parsed.monto1) $('#pago-monto1').value = parsed.monto1;
    if (parsed.vencimiento2) $('#pago-vencimiento2').value = parsed.vencimiento2;
    if (parsed.monto2) $('#pago-monto2').value = parsed.monto2;
    if (parsed.datosExtra) $('#pago-datos-extra').value = parsed.datosExtra;

    const alertsEl = $('#extraction-alerts');
    if (parsed.alerts && parsed.alerts.length > 0) {
      alertsEl.innerHTML = `<strong>⚠️ Puntos de atención detectados:</strong><ul>${parsed.alerts
        .map((a) => `<li>${escapeHtml(a)}</li>`)
        .join('')}</ul>`;
      alertsEl.classList.remove('hidden');
    } else {
      alertsEl.classList.add('hidden');
    }
  }

  async function handlePagoFileUpload(file) {
    if (!file) return;
    const statusBar = $('#ocr-status-bar');
    const statusText = $('#ocr-status-text');
    statusBar.classList.remove('hidden');
    statusText.textContent = `Leyendo "${file.name}" atentamente...`;

    try {
      const dataUrl = await fileToDataUrl(file);
      state.currentDraftFile = {
        nombre: file.name,
        tipo: file.type,
        dataUrl,
        rawText: ''
      };
      renderFilePreview(file.name, file.type, dataUrl);

      const { text, parsed } = await Parser.readFile(file, (pct) => {
        statusText.textContent = `Leyendo imagen (OCR): ${pct}%...`;
      });

      state.currentDraftFile.rawText = text;
      $('#raw-extracted-text').value = text;
      applyParsedFields(parsed);
      toast('Documento leído y analizado correctamente.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Se adjuntó el archivo, pero no se pudo leer automáticamente.', 'warning');
    } finally {
      statusBar.classList.add('hidden');
    }
  }

  // Event Listeners
  function bindEvents() {
    // Sidebar nav
    $$('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $$('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.goto));
    });

    // Month picker
    const monthInput = $('#global-month');
    monthInput.value = state.activeMonth;
    monthInput.addEventListener('change', (e) => {
      if (e.target.value) {
        state.activeMonth = e.target.value;
        renderAll();
      }
    });

    const shiftMonth = (delta) => {
      const [y, m] = state.activeMonth.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      state.activeMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthInput.value = state.activeMonth;
      renderAll();
    };
    $('#prev-month-btn').addEventListener('click', () => shiftMonth(-1));
    $('#next-month-btn').addEventListener('click', () => shiftMonth(1));

    // Global search
    $('#global-search').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderAll();
    });

    // Quick upload buttons
    $('#btn-quick-upload').addEventListener('click', () => {
      resetPagoModal();
      openModal('modal-pago');
    });
    $('#btn-new-pago').addEventListener('click', () => {
      resetPagoModal();
      openModal('modal-pago');
    });

    // Dashboard dropzone
    const dashDrop = $('#dashboard-dropzone');
    const dashInput = $('#dashboard-file-input');
    $('#dashboard-browse-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      dashInput.click();
    });
    dashDrop.addEventListener('click', () => dashInput.click());
    dashDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      dashDrop.classList.add('dragover');
    });
    dashDrop.addEventListener('dragleave', () => dashDrop.classList.remove('dragover'));
    dashDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      dashDrop.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) {
        resetPagoModal();
        openModal('modal-pago');
        handlePagoFileUpload(file);
      }
    });
    dashInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        resetPagoModal();
        openModal('modal-pago');
        handlePagoFileUpload(file);
      }
      e.target.value = '';
    });

    // Modal Pago dropzone
    const pagoDrop = $('#pago-dropzone');
    const pagoInput = $('#pago-file-input');
    $('#pago-browse-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      pagoInput.click();
    });
    pagoDrop.addEventListener('click', () => pagoInput.click());
    pagoDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      pagoDrop.classList.add('dragover');
    });
    pagoDrop.addEventListener('dragleave', () => pagoDrop.classList.remove('dragover'));
    pagoDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      pagoDrop.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handlePagoFileUpload(e.dataTransfer.files[0]);
    });
    pagoInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handlePagoFileUpload(e.target.files[0]);
      e.target.value = '';
    });

    // Raw text toggle & re-parse & paste email
    $('#btn-toggle-raw-text').addEventListener('click', () => {
      $('#raw-text-panel').classList.toggle('hidden');
    });
    $('#btn-open-paste-text').addEventListener('click', () => {
      $('#file-preview-box').classList.remove('hidden');
      $('#raw-text-panel').classList.remove('hidden');
      $('#raw-extracted-text').focus();
    });
    $('#btn-reparse-text').addEventListener('click', () => {
      const txt = $('#raw-extracted-text').value;
      if (!txt.trim()) return toast('Pegá o ingresá texto primero para analizar.', 'warning');
      const parsed = Parser.parseDocumentText(txt, state.currentDraftFile?.nombre || '');
      applyParsedFields(parsed);
      toast('Texto re-analizado.');
    });

    // Comprobante de pago upload
    $('#pago-comprobante-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
      state.currentDraftComprobante = { nombre: file.name, tipo: file.type, dataUrl };
      $('#pago-comprobante-name').textContent = `Adjunto: ${file.name}`;
    });

    // Form Pago submit
    $('#form-pago').addEventListener('submit', async (e) => {
      e.preventDefault();
      const existingId = $('#pago-id').value;
      const existing = existingId ? state.pagos.find((p) => p.id === existingId) : null;
      const estado = $('#pago-estado').value;
      let fechaPago = $('#pago-fecha-pago').value;
      if (estado === 'pagado' && !fechaPago) fechaPago = todayISO();

      const record = {
        id: existingId || uid('pago'),
        categoria: $('#pago-categoria').value,
        frecuencia: $('#pago-frecuencia').value,
        titulo: $('#pago-titulo').value.trim(),
        periodo: $('#pago-periodo').value || state.activeMonth,
        identificador: $('#pago-identificador').value.trim(),
        vencimiento1: $('#pago-vencimiento1').value || null,
        monto1: $('#pago-monto1').value ? parseFloat($('#pago-monto1').value) : null,
        vencimiento2: $('#pago-vencimiento2').value || null,
        monto2: $('#pago-monto2').value ? parseFloat($('#pago-monto2').value) : null,
        estado,
        fechaPago: estado === 'pagado' ? fechaPago : null,
        datosExtra: $('#pago-datos-extra').value.trim(),
        notas: $('#pago-notas').value.trim(),
        archivoNombre: state.currentDraftFile?.nombre ?? existing?.archivoNombre ?? null,
        archivoTipo: state.currentDraftFile?.tipo ?? existing?.archivoTipo ?? null,
        archivoDataUrl: state.currentDraftFile?.dataUrl ?? existing?.archivoDataUrl ?? null,
        rawText: $('#raw-extracted-text').value || existing?.rawText || '',
        comprobanteNombre: state.currentDraftComprobante?.nombre ?? existing?.comprobanteNombre ?? null,
        comprobanteTipo: state.currentDraftComprobante?.tipo ?? existing?.comprobanteTipo ?? null,
        comprobanteDataUrl: state.currentDraftComprobante?.dataUrl ?? existing?.comprobanteDataUrl ?? null,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await DB.put('pagos', record);
      await DB.logActividad('pago', `${existing ? 'Actualizado' : 'Cargado'}: ${record.titulo} (${record.estado}).`);
      closeModal('modal-pago');
      toast('Comprobante guardado en la agenda.');
      await reloadData();
    });

    // Filtros Pagos
    $$('#pagos-category-filters .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        $$('#pagos-category-filters .chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        state.pagosCatFilter = chip.dataset.cat;
        renderPagos(getPagosForMonth(state.activeMonth));
      });
    });

    $('#pagos-status-filter').addEventListener('change', (e) => {
      state.pagosStatusFilter = e.target.value;
      renderPagos(getPagosForMonth(state.activeMonth));
    });

    $('#tareas-status-filter').addEventListener('change', (e) => {
      state.tareasStatusFilter = e.target.value;
      renderRecordatorios(getTareasForMonth(state.activeMonth));
    });

    // Modal Tarea
    $('#btn-new-tarea').addEventListener('click', () => {
      $('#modal-tarea-title').textContent = 'Nuevo Recordatorio Mensual';
      $('#form-tarea').reset();
      $('#tarea-id').value = '';
      openModal('modal-tarea');
    });

    $('#form-tarea').addEventListener('submit', async (e) => {
      e.preventDefault();
      const existingId = $('#tarea-id').value;
      const existing = existingId ? state.tareas.find((t) => t.id === existingId) : null;
      const recurrente = $('#tarea-recurrente').value === 'true';

      const tarea = {
        id: existingId || uid('tarea'),
        titulo: $('#tarea-titulo').value.trim(),
        descripcion: $('#tarea-descripcion').value.trim(),
        diaLimite: parseInt($('#tarea-dia-limite').value, 10) || 10,
        canal: $('#tarea-canal').value,
        prioridad: $('#tarea-prioridad').value,
        recurrente,
        mesUnico: recurrente ? null : state.activeMonth,
        active: true,
        createdAt: existing?.createdAt || new Date().toISOString()
      };

      await DB.put('tareas', tarea);
      await DB.logActividad('recordatorio', `${existing ? 'Editado' : 'Creado'} recordatorio: ${tarea.titulo}`);
      closeModal('modal-tarea');
      toast('Recordatorio guardado.');
      await reloadData();
    });

    // Close modals
    $$('.close-modal').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    $$('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal(backdrop.id);
      });
    });

    // Delegated clicks
    document.addEventListener('click', async (e) => {
      const btnNewSrv = e.target.closest('[data-new-srv]');
      if (btnNewSrv) {
        resetPagoModal(btnNewSrv.dataset.newSrv);
        openModal('modal-pago');
        return;
      }

      const btnTogglePago = e.target.closest('[data-toggle-pago]');
      if (btnTogglePago) {
        const pago = state.pagos.find((p) => p.id === btnTogglePago.dataset.togglePago);
        if (!pago) return;
        const nextEstado = pago.estado === 'pagado' ? 'pendiente' : 'pagado';
        pago.estado = nextEstado;
        pago.fechaPago = nextEstado === 'pagado' ? todayISO() : null;
        pago.updatedAt = new Date().toISOString();
        await DB.put('pagos', pago);
        await DB.logActividad('pago', `Marcado como ${nextEstado}: ${pago.titulo}`);
        toast(nextEstado === 'pagado' ? 'Marcado como pagado.' : 'Pago reabierto como pendiente.');
        await reloadData();
        return;
      }

      const btnEditPago = e.target.closest('[data-edit-pago]');
      if (btnEditPago) {
        const pago = state.pagos.find((p) => p.id === btnEditPago.dataset.editPago);
        if (!pago) return;
        resetPagoModal(pago.categoria);
        $('#modal-pago-title').textContent = 'Editar Comprobante';
        $('#pago-id').value = pago.id;
        $('#pago-categoria').value = pago.categoria;
        $('#pago-frecuencia').value = pago.frecuencia || 'Mensual';
        $('#pago-titulo').value = pago.titulo;
        $('#pago-periodo').value = pago.periodo;
        $('#pago-identificador').value = pago.identificador || '';
        $('#pago-vencimiento1').value = pago.vencimiento1 || '';
        $('#pago-monto1').value = pago.monto1 ?? '';
        $('#pago-vencimiento2').value = pago.vencimiento2 || '';
        $('#pago-monto2').value = pago.monto2 ?? '';
        $('#pago-estado').value = pago.estado || 'pendiente';
        $('#pago-fecha-pago').value = pago.fechaPago || '';
        $('#pago-datos-extra').value = pago.datosExtra || '';
        $('#pago-notas').value = pago.notas || '';
        $('#raw-extracted-text').value = pago.rawText || '';
        if (pago.archivoDataUrl) renderFilePreview(pago.archivoNombre, pago.archivoTipo, pago.archivoDataUrl);
        if (pago.comprobanteNombre) $('#pago-comprobante-name').textContent = `Adjunto: ${pago.comprobanteNombre}`;
        openModal('modal-pago');
        return;
      }

      const btnDelPago = e.target.closest('[data-del-pago]');
      if (btnDelPago) {
        const pago = state.pagos.find((p) => p.id === btnDelPago.dataset.delPago);
        if (!pago || !confirm(`¿Eliminar "${pago.titulo}"?`)) return;
        await DB.remove('pagos', pago.id);
        await DB.logActividad('pago', `Eliminado: ${pago.titulo}`);
        toast('Registro eliminado.', 'warning');
        await reloadData();
        return;
      }

      const btnViewFile = e.target.closest('[data-view-file]');
      if (btnViewFile) {
        const pago = state.pagos.find((p) => p.id === btnViewFile.dataset.viewFile);
        if (!pago) return;
        const kind = btnViewFile.dataset.kind;
        const dataUrl = kind === 'comprobante' ? pago.comprobanteDataUrl : pago.archivoDataUrl;
        const nombre = kind === 'comprobante' ? pago.comprobanteNombre : pago.archivoNombre;
        const tipo = kind === 'comprobante' ? pago.comprobanteTipo : pago.archivoTipo;
        if (!dataUrl) return;

        $('#viewer-title').textContent = `${pago.titulo} — ${nombre || 'Archivo'}`;
        let contentHtml = '';
        if ((tipo && tipo.startsWith('image/')) || /^data:image\//.test(dataUrl)) {
          contentHtml = `<img src="${dataUrl}" style="max-width:100%;max-height:65vh;display:block;margin:0 auto;" />`;
        } else if (tipo === 'application/pdf' || /^data:application\/pdf/.test(dataUrl)) {
          contentHtml = `<embed src="${dataUrl}" type="application/pdf" style="width:100%;height:65vh;" />`;
        } else {
          contentHtml = `<pre style="white-space:pre-wrap;font-size:12.5px;">${escapeHtml(pago.rawText || 'Sin vista previa')}</pre>`;
        }
        $('#viewer-body').innerHTML = `
          ${contentHtml}
          <div style="margin-top:14px;display:flex;justify-content:flex-end;">
            <a href="${dataUrl}" download="${escapeHtml(nombre || 'archivo')}" class="btn btn-primary btn-sm">⬇️ Descargar archivo</a>
          </div>
        `;
        openModal('modal-viewer');
        return;
      }

      const btnQuickTarea = e.target.closest('[data-quick-tarea]');
      if (btnQuickTarea) {
        const tareaId = btnQuickTarea.dataset.quickTarea;
        const key = `${state.activeMonth}__${tareaId}`;
        const existing = state.tareasEstado.find((s) => s.key === key);
        const nextEstado = existing && existing.estado === 'hecho' ? 'pendiente' : 'hecho';
        await DB.put('tareas_estado', {
          key,
          periodo: state.activeMonth,
          tareaId,
          estado: nextEstado,
          fechaHecho: nextEstado === 'hecho' ? todayISO() : null,
          nota: existing?.nota || '',
          updatedAt: new Date().toISOString()
        });
        const tObj = state.tareas.find((t) => t.id === tareaId);
        await DB.logActividad('recordatorio', `${tObj?.titulo || 'Tarea'} marcada como ${nextEstado} (${state.activeMonth}).`);
        await reloadData();
        return;
      }

      const btnEditTarea = e.target.closest('[data-edit-tarea]');
      if (btnEditTarea) {
        const t = state.tareas.find((x) => x.id === btnEditTarea.dataset.editTarea);
        if (!t) return;
        $('#modal-tarea-title').textContent = 'Editar Recordatorio';
        $('#tarea-id').value = t.id;
        $('#tarea-titulo').value = t.titulo;
        $('#tarea-descripcion').value = t.descripcion || '';
        $('#tarea-dia-limite').value = t.diaLimite || 10;
        $('#tarea-canal').value = t.canal || 'Correo / Sistema';
        $('#tarea-prioridad').value = t.prioridad || 'media';
        $('#tarea-recurrente').value = t.recurrente ? 'true' : 'false';
        openModal('modal-tarea');
        return;
      }

      const btnDelTarea = e.target.closest('[data-del-tarea]');
      if (btnDelTarea) {
        const t = state.tareas.find((x) => x.id === btnDelTarea.dataset.delTarea);
        if (!t || !confirm(`¿Eliminar el recordatorio "${t.titulo}"?`)) return;
        t.active = false;
        await DB.put('tareas', t);
        await DB.logActividad('recordatorio', `Eliminado recordatorio: ${t.titulo}`);
        toast('Recordatorio eliminado.', 'warning');
        await reloadData();
      }
    });

    // Delegated changes para recordatorios (estado y nota mensual)
    document.addEventListener('change', async (e) => {
      const selEstado = e.target.closest('[data-tarea-estado]');
      if (selEstado) {
        const tareaId = selEstado.dataset.tareaEstado;
        const key = `${state.activeMonth}__${tareaId}`;
        const existing = state.tareasEstado.find((s) => s.key === key);
        const estado = selEstado.value;
        await DB.put('tareas_estado', {
          key,
          periodo: state.activeMonth,
          tareaId,
          estado,
          fechaHecho: estado === 'hecho' ? todayISO() : null,
          nota: existing?.nota || '',
          updatedAt: new Date().toISOString()
        });
        const tObj = state.tareas.find((t) => t.id === tareaId);
        await DB.logActividad('recordatorio', `${tObj?.titulo || 'Tarea'} → ${estado} (${state.activeMonth}).`);
        toast('Estado actualizado.');
        await reloadData();
        return;
      }

      const inpNota = e.target.closest('[data-tarea-nota]');
      if (inpNota) {
        const tareaId = inpNota.dataset.tareaNota;
        const key = `${state.activeMonth}__${tareaId}`;
        const existing = state.tareasEstado.find((s) => s.key === key);
        await DB.put('tareas_estado', {
          key,
          periodo: state.activeMonth,
          tareaId,
          estado: existing?.estado || 'pendiente',
          fechaHecho: existing?.fechaHecho || null,
          nota: inpNota.value.trim(),
          updatedAt: new Date().toISOString()
        });
        toast('Nota mensual guardada.');
      }
    });

    // Export / Import Backup
    $('#btn-export-backup').addEventListener('click', async () => {
      const payload = await DB.exportAll();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `soemlp-fesimubo-respaldo-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Respaldo descargado.');
    });

    $('#btn-import-backup').addEventListener('click', () => $('#import-backup-input').click());
    $('#import-backup-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!confirm('Esto reemplazará los datos actuales por los del respaldo. ¿Continuar?')) return;
        await DB.importAll(data);
        toast('Respaldo restaurado correctamente.');
        await reloadData();
      } catch (err) {
        toast(err.message || 'No se pudo importar el respaldo.', 'error');
      }
      e.target.value = '';
    });
  }

  // Init
  async function init() {
    await DB.initSeed();
    bindEvents();
    await reloadData();
  }

  init().catch((err) => {
    console.error(err);
    alert('Error al iniciar la aplicación: ' + err.message);
  });
})();
