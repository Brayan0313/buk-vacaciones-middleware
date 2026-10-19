const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// --- 1. LISTA DE FESTIVOS NACIONALES (Ajustar según año/país) ---
// Ejemplo para Colombia 2026 en formato YYYY-MM-DD
const FESTIVOS = [
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
  '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
  '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
  '2026-11-16', '2026-12-08', '2026-12-25'
];

// --- 2. FUNCIONES HELPER PARA DÍAS HÁBILES Y FECHAS ---

function esNoHabil(fecha) {
  const diaSemana = fecha.getDay(); // 0 = Domingo, 6 = Sábado
  if (diaSemana === 0 || diaSemana === 6) return true;

  // Formato YYYY-MM-DD para comparar con la lista de festivos
  const isoFecha = fecha.toISOString().split('T')[0];
  return FESTIVOS.includes(isoFecha);
}

// Retrocede hasta el día hábil más cercano si cae fin de semana o festivo
function obtenerDiaHabilAnterior(fecha) {
  const f = new Date(fecha);
  while (esNoHabil(f)) {
    f.setDate(f.getDate() - 1);
  }
  return f;
}

// Resta N días hábiles a una fecha dada
function restarDiasHabiles(fecha, dias) {
  const f = new Date(fecha);
  let restados = 0;
  while (restados < dias) {
    f.setDate(f.getDate() - 1);
    if (!esNoHabil(f)) {
      restados++;
    }
  }
  return f;
}

// Calcula la fecha de cierre de novedades para la quincena/mes actual
function obtenerFechaCierreNovedades(fechaReferencia) {
  const ano = fechaReferencia.getFullYear();
  const mes = fechaReferencia.getMonth();
  const dia = fechaReferencia.getDate();

  let diaPagoTeorico;

  // Definir día de pago teórico (15 o último día del mes)
  if (dia <= 15) {
    diaPagoTeorico = new Date(ano, mes, 15);
  } else {
    diaPagoTeorico = new Date(ano, mes + 1, 0); // Último día del mes
  }

  // 1. Si el día de pago cae fin de semana/festivo, el pago es el día hábil anterior
  const diaPagoReal = obtenerDiaHabilAnterior(diaPagoTeorico);

  // 2. El cierre de novedades es X días hábiles antes del pago real (Ejemplo: 2 días hábiles)
  const DIAS_ANTICIPACION_CIERRE = 2;
  const fechaCierre = restarDiasHabiles(diaPagoReal, DIAS_ANTICIPACION_CIERRE);

  fechaCierre.setHours(23, 59, 59, 999);
  return fechaCierre;
}


// --- 3. ENDPOINT PRINCIPAL DEL MIDDLEWARE ---

app.post('/api/index', async (req, res) => {
  try {
    const { event_type, data } = req.body;

    if (event_type === 'vacation_create') {
      const vacationId = data.vacation_id;
      const bukDomain = process.env.BUK_DOMAIN;
      const authToken = process.env.BUK_AUTH_TOKEN;

      // Consultar detalle de la vacación en la API de BUK
      const response = await axios.get(`https://${bukDomain}/api/v1/vacations/${vacationId}`, {
        headers: { 'auth_token': authToken }
      });

      const vacacion = response.data.data;
      
      // Normalizar fechas para comparar solo año, mes y día (sin horas)
      const fechaInicioVacacion = new Date(vacacion.start_date);
      fechaInicioVacacion.setHours(0, 0, 0, 0);

      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);

      // -------------------------------------------------------------
      // REGLAS DE NEGOCIO
      // -------------------------------------------------------------

      // REGLA 1: No se permite registrar fechas anteriores o iguales a hoy (solo posteriores)
      const esRetroactivaOMismoDia = fechaInicioVacacion <= hoy;

      // REGLA 2: No se permite registrar dentro de un periodo de nómina cuyo cierre ya pasó
      const fechaCierreActual = obtenerFechaCierreNovedades(new Date());
      const yaPasoElCierre = new Date() > fechaCierreActual;
      const esParaElPeriodoActual = fechaInicioVacacion <= fechaCierreActual;
      const afectaQuincenaCerrada = yaPasoElCierre && esParaElPeriodoActual;

      // EVALUACIÓN FINAL: Si incumple cualquier regla, se elimina de BUK
      if (esRetroactivaOMismoDia || afectaQuincenaCerrada) {
        console.log(`[RECHAZADO] Solicitud ${vacationId} anulada por reglas de fecha/nómina.`);

        await axios.delete(`https://${bukDomain}/api/v1/vacations/${vacationId}`, {
          headers: { 'auth_token': authToken }
        });
      }
    }

    return res.status(200).send({ status: 'success' });
  } catch (error) {
    console.error('Error procesando webhook:', error.message);
    return res.status(500).send({ error: error.message });
  }
});

module.exports = app;
