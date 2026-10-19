const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

app.post('/api/index', async (req, res) => {
  try {
    const { event_type, data } = req.body;

    if (event_type === 'vacation_create') {
      const vacationId = data.vacation_id;
      const bukDomain = process.env.BUK_DOMAIN; 
      const authToken = process.env.BUK_AUTH_TOKEN;

      // 1. Obtener detalles de la vacación solicitada
      const response = await axios.get(`https://${bukDomain}/api/v1/vacations/${vacationId}`, {
        headers: { 'auth_token': authToken }
      });

      const vacacion = response.data.data;
      const fechaInicio = new Date(vacacion.start_date);
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);

      // 2. Si la fecha es retroactiva (anterior a hoy), eliminar la solicitud
      if (fechaInicio < hoy) {
        await axios.delete(`https://${bukDomain}/api/v1/vacations/${vacationId}`, {
          headers: { 'auth_token': authToken }
        });
        console.log(`Solicitud retroactiva ${vacationId} eliminada automáticamente.`);
      }
    }

    return res.status(200).send({ status: 'success' });
  } catch (error) {
    console.error('Error procesando webhook:', error.message);
    return res.status(500).send({ error: error.message });
  }
});

module.exports = app;
