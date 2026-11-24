/**
 * Lector Inteligente de Facturas, Cupones, Liquidaciones y Remitos (PDF, Imagen OCR, Texto)
 * Diseñado para que no se escape ningún vencimiento, importe, NIS, póliza, remito o dato clave.
 */
window.SoemlpParser = (() => {
  const MONTHS_ES = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
    noviembre: '11', diciembre: '12'
  };

  function parseArNumber(str) {
    if (!str) return null;
    let clean = str.replace(/[^\d.,]/g, '').trim();
    if (!clean) return null;

    // Caso argentino típico: 125.430,50 -> 125430.50
    if (clean.includes(',') && clean.includes('.')) {
      if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
      } else {
        clean = clean.replace(/,/g, '');
      }
    } else if (clean.includes(',')) {
      const parts = clean.split(',');
      if (parts[parts.length - 1].length <= 2) {
        clean = clean.replace(',', '.');
      } else {
        clean = clean.replace(/,/g, '');
      }
    } else if (clean.includes('.')) {
      const parts = clean.split('.');
      // Si tiene 3 dígitos después del punto (ej: 45.200), es separador de miles
      if (parts[parts.length - 1].length === 3 && parts.length >= 2) {
        clean = clean.replace(/\./g, '');
      }
    }

    const num = parseFloat(clean);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  function normalizeDate(raw) {
    if (!raw) return null;
    const numeric = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (numeric) {
      let [, d, m, y] = numeric;
      if (y.length === 2) y = '20' + y;
      const day = d.padStart(2, '0');
      const month = m.padStart(2, '0');
      const monthNum = parseInt(month, 10);
      const dayNum = parseInt(day, 10);
      if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
        return `${y}-${month}-${day}`;
      }
    }
    const textDate = raw.toLowerCase().match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de\s+)?(\d{4})/);
    if (textDate) {
      const day = textDate[1].padStart(2, '0');
      const month = MONTHS_ES[textDate[2]];
      const year = textDate[3];
      if (month) return `${year}-${month}-${day}`;
    }
    return null;
  }

  function detectCategory(text, fileName = '') {
    const haystack = `${fileName}\n${text}`.toLowerCase();
    if (/\btelecentro\b/.test(haystack)) return { categoria: 'Telecentro', frecuencia: 'Mensual' };
    if (/\bnis\b|edesur|edenor|edelap|edea|energ[ií]a\s+el[eé]ctrica|\bkwh\b/.test(haystack)) {
      return { categoria: 'Luz', frecuencia: 'Mensual' };
    }
    if (/\bp[oó]liza\b|\bseguro\b|aseguradora|cup[oó]n\s+de\s+pago|sancor|federaci[oó]n\s+patronal|rivadavia|la\s+caja|mapfre|allianz/.test(haystack)) {
      return { categoria: 'Seguro', frecuencia: 'Mensual' };
    }
    if (/\balquiler\b|locaci[oó]n|locador|locatario|inmobiliaria|expensas|liquidaci[oó]n\s+de\s+alquiler/.test(haystack)) {
      return { categoria: 'Alquiler', frecuencia: 'Mensual' };
    }
    if (/\bremito\b|bid[oó]n|bidones|dispenser|\bagua\b|aysa|absa|ivess/.test(haystack)) {
      const freq = /remito|semanal|bid[oó]n|bidones/.test(haystack) ? 'Semanal' : 'Mensual';
      return { categoria: 'Agua', frecuencia: freq };
    }
    return { categoria: 'Otro', frecuencia: 'Mensual' };
  }

  function parseDocumentText(rawText, fileName = '') {
    const text = (rawText || '').replace(/\r/g, '');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const { categoria, frecuencia } = detectCategory(text, fileName);

    let vencimiento1 = null;
    let vencimiento2 = null;
    let monto1 = null;
    let monto2 = null;

    // 1. Buscar vencimientos etiquetados línea por línea
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1] || '';
      const windowText = `${line} ${nextLine}`;

      if (!vencimiento1 && /(1[°ºer]*\s*vto|1[°ºer]*\s*vencimiento|primer\s*vencimiento|vto\.?\s*original)/i.test(line)) {
        const d = normalizeDate(windowText);
        if (d) vencimiento1 = d;
        const mMatch = windowText.match(/\$\s*([\d.,]+)/);
        if (mMatch && !monto1) monto1 = parseArNumber(mMatch[1]);
      }

      if (!vencimiento2 && /(2[°ºdo]*\s*vto|2[°ºdo]*\s*vencimiento|segundo\s*vencimiento)/i.test(line)) {
        const d = normalizeDate(windowText);
        if (d) vencimiento2 = d;
        const mMatch = windowText.match(/\$\s*([\d.,]+)/);
        if (mMatch && !monto2) monto2 = parseArNumber(mMatch[1]);
      }
    }

    // Si no encontró 1° vencimiento específico, buscar "vencimiento" o "vto" genérico
    if (!vencimiento1) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/(vencimiento|vto\.?|fecha\s*l[ií]mite|vence\s*el)/i.test(line)) {
          const d = normalizeDate(`${line} ${lines[i + 1] || ''}`);
          if (d) {
            vencimiento1 = d;
            break;
          }
        }
      }
    }

    // 2. Buscar importes totales si aún faltan
    const totalPatterns = [
      /(?:total\s+a\s+pagar|importe\s+total|total\s+factura|total\s+liquidaci[oó]n|saldo\s+a\s+pagar|neto\s+a\s+pagar|total\s*\$?)[:\s]*\$?\s*([\d.,]+)/gi,
      /(?:importe|monto|cuota\s+total)[:\s]*\$?\s*([\d.,]+)/gi
    ];

    if (!monto1) {
      for (const pat of totalPatterns) {
        let match;
        while ((match = pat.exec(text)) !== null) {
          const val = parseArNumber(match[1]);
          if (val && val > 10) {
            monto1 = val;
            break;
          }
        }
        if (monto1) break;
      }
    }

    // Fallback: si sigue sin monto1, buscar todos los "$ XXX" y tomar el mayor razonable
    let montoEsEstimado = false;
    if (!monto1) {
      const allAmounts = [];
      const moneyRegex = /\$\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g;
      let m;
      while ((m = moneyRegex.exec(text)) !== null) {
        const val = parseArNumber(m[1]);
        if (val && val >= 50) allAmounts.push(val);
      }
      if (allAmounts.length > 0) {
        monto1 = Math.max(...allAmounts);
        montoEsEstimado = true;
      }
    }

    // 3. Identificadores clave según servicio
    const extraParts = [];
    let identificador = '';

    const nisMatch = text.match(/\bNIS\b[:\s#N°]*([0-9\-]{5,14})/i);
    if (nisMatch) {
      identificador = `NIS ${nisMatch[1]}`;
      extraParts.push(`NIS: ${nisMatch[1]}`);
    }

    const polizaMatch = text.match(/P[oó]liza[:\s#N°]*([A-Z0-9\-\/]{4,20})/i);
    if (polizaMatch) {
      if (!identificador) identificador = `Póliza ${polizaMatch[1]}`;
      extraParts.push(`Póliza: ${polizaMatch[1]}`);
    }

    const cuotaMatch = text.match(/Cuota[:\s#N°]*(\d{1,2}(?:\s*(?:de|\/)\s*\d{1,2})?)/i);
    if (cuotaMatch) extraParts.push(`Cuota: ${cuotaMatch[1]}`);

    const remitoMatch = text.match(/Remito[:\s#N°]*([0-9\-]{3,16})/i);
    if (remitoMatch) {
      if (!identificador) identificador = `Remito ${remitoMatch[1]}`;
      extraParts.push(`Remito N°: ${remitoMatch[1]}`);
    }

    const clienteMatch = text.match(/(?:N[°º]?\s*de\s*Cliente|Cliente|Cuenta|Referencia\s*de\s*pago)[:\s#N°]*([A-Z0-9\-]{4,20})/i);
    if (clienteMatch) {
      if (!identificador) identificador = `Cliente ${clienteMatch[1]}`;
      extraParts.push(`Cliente/Cuenta: ${clienteMatch[1]}`);
    }

    const facturaMatch = text.match(/(?:Factura|Liquidaci[oó]n|Comprobante)[^0-9\n]{0,12}(\d{4,5}\s*-\s*\d{6,8})/i);
    if (facturaMatch) {
      const fNum = facturaMatch[1].replace(/\s+/g, '');
      if (!identificador) identificador = `Comp. ${fNum}`;
      extraParts.push(`Comprobante: ${fNum}`);
    }

    const cuitMatch = text.match(/CUIT[:\s]*(\d{2}-\d{8}-\d{1}|\d{11})/i);
    if (cuitMatch) extraParts.push(`CUIT: ${cuitMatch[1]}`);

    const caeMatch = text.match(/CAE[:\s#N°]*(\d{14})/i);
    if (caeMatch) extraParts.push(`CAE: ${caeMatch[1]}`);

    const cbuMatch = text.match(/CBU[:\s]*(\d{22})/i);
    if (cbuMatch) extraParts.push(`CBU: ${cbuMatch[1]}`);

    const aliasMatch = text.match(/Alias[:\s]*([a-zA-Z0-9.\-_]{4,30})/i);
    if (aliasMatch) extraParts.push(`Alias: ${aliasMatch[1]}`);

    const pagoElecMatch = text.match(/(?:C[oó]digo\s*de\s*Pago\s*Electr[oó]nico|Pago\s*Mis\s*Cuentas|Link\s*Pagos)[:\s#N°]*(\d{6,24})/i);
    if (pagoElecMatch) extraParts.push(`Pago Electrónico: ${pagoElecMatch[1]}`);

    const consumoMatch = text.match(/(\d+(?:[.,]\d+)?\s*(?:kWh|m3|bidones|unidades))/i);
    if (consumoMatch) extraParts.push(`Consumo/Cant.: ${consumoMatch[1]}`);

    // 4. Período facturado
    let periodo = null;
    const perMatch = text.match(/(?:Per[ií]odo|Mes\s*facturado|Liquidaci[oí]n)[:\s]*(\d{1,2})[\/\-](\d{4})/i);
    if (perMatch) {
      periodo = `${perMatch[2]}-${perMatch[1].padStart(2, '0')}`;
    } else if (vencimiento1) {
      periodo = vencimiento1.slice(0, 7);
    }

    // 5. Título sugerido
    const baseName = fileName ? fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : '';
    const titulo = identificador
      ? `${categoria} · ${identificador}`
      : baseName
      ? `${categoria} · ${baseName}`
      : `${categoria} · Comprobante`;

    // 6. Alertas de lectura atenta
    const alerts = [];
    if (!vencimiento1) alerts.push('No se detectó fecha de vencimiento clara: revisá el archivo y completala manualmente.');
    if (!monto1) alerts.push('No se detectó el importe total: verificalo en la vista previa.');
    if (montoEsEstimado) alerts.push('El importe fue tomado del monto máximo hallado ($' + monto1 + '). Confirmá que coincida con el total a pagar.');
    if (vencimiento2 && monto2 && monto1 && monto2 > monto1) {
      alerts.push(`Atención: posee 2° vencimiento (${vencimiento2}) con recargo a $${monto2.toLocaleString('es-AR')}.`);
    }
    if (cbuMatch || aliasMatch || pagoElecMatch) {
      alerts.push('Se detectaron datos de pago electrónico / transferencia en el documento.');
    }

    return {
      categoria,
      frecuencia,
      titulo,
      periodo,
      identificador,
      vencimiento1,
      monto1,
      vencimiento2,
      monto2,
      datosExtra: extraParts.join(' | '),
      alerts
    };
  }

  async function extractTextFromPDF(file) {
    if (!window.pdfjsLib) {
      throw new Error('La librería PDF.js no está disponible (verificá tu conexión o pegá el texto manualmente).');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const buffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    const pagesText = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Agrupar por coordenada Y para reconstruir líneas de facturas/tablas
      const rows = [];
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] / 4) * 4;
        const x = item.transform[4];
        let row = rows.find((r) => Math.abs(r.y - y) <= 4);
        if (!row) {
          row = { y, items: [] };
          rows.push(row);
        }
        row.items.push({ x, str: item.str });
      }
      rows.sort((a, b) => b.y - a.y);
      const pageLines = rows.map((r) =>
        r.items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join(' ')
      );
      pagesText.push(pageLines.join('\n'));
    }
    return pagesText.join('\n\n');
  }

  async function extractTextFromImage(file, onProgress) {
    if (!window.Tesseract) {
      throw new Error('El motor OCR (Tesseract.js) no está disponible (verificá tu conexión o completá los campos manualmente).');
    }
    const result = await window.Tesseract.recognize(file, 'spa+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof onProgress === 'function') {
          onProgress(Math.round((m.progress || 0) * 100));
        }
      }
    });
    return result?.data?.text || '';
  }

  async function readFile(file, onProgress) {
    const name = file.name || '';
    const type = file.type || '';

    if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
      const text = await extractTextFromPDF(file);
      return { text, parsed: parseDocumentText(text, name) };
    }

    if (type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(name)) {
      const text = await extractTextFromImage(file, onProgress);
      return { text, parsed: parseDocumentText(text, name) };
    }

    // Texto plano / EML / CSV
    const text = await file.text();
    return { text, parsed: parseDocumentText(text, name) };
  }

  return {
    readFile,
    parseDocumentText
  };
})();
