// server.js — BACKEND CON PAYWAY (PARAGUAY)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Para llamar a Payway API

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de Payway
const PAYWAY_API_KEY = process.env.PAYWAY_API_KEY; // Obtén esto en https://www.payway.com.py/
const PAYWAY_API_URL = 'https://api.payway.com.py/v1';

// Configuración de correo (opcional)
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    message: 'Backend de Payway para Cajero Emprender',
    status: 'online',
    endpoints: {
      createPayment: 'POST /api/create-payment',
      verifyPayment: 'GET /api/verify-payment/:paymentId',
    }
  });
});

// ========== CREAR PAGO EN PAYWAY ==========
app.post('/api/create-payment', async (req, res) => {
  try {
    const { 
      amount,           // en Gs (ej: 50000)
      email,            // email del cliente
      paymentMethod,    // 'tigo_money', 'transferencia', 'debit_card', etc.
      description = 'Pago en Cajero Emprender',
      vendorId,         // opcional, para comisiones
    } = req.body;

    if (!amount || !email || !paymentMethod) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    // Si tienes comisiones, calcula aquí
    // Ej: comisión del 5% → monto_vendedor = amount * 0.95

    const paywayResponse = await axios.post(
      `${PAYWAY_API_URL}/payments`,
      {
        amount: Math.round(amount), // en Gs, sin decimales
        currency: 'PYG',
        email: email,
        payment_method: paymentMethod,
        description: description,
        // Si usas comisiones, agrega:
        // vendor_id: vendorId,
        // commission: Math.round(amount * 0.05),
      },
      {
        headers: {
          'Authorization': `Bearer ${PAYWAY_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const { id, payment_url, status } = paywayResponse.data;

    res.json({
      payment_id: id,
      payment_url: payment_url, // URL para redirigir al cliente
      status: status,
    });

  } catch (error) {
    console.error('Error creando pago en Payway:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Error al crear el pago', 
      details: error.response?.data?.message || error.message 
    });
  }
});

// ========== VERIFICAR ESTADO DEL PAGO ==========
app.get('/api/verify-payment/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;

    const paywayResponse = await axios.get(
      `${PAYWAY_API_URL}/payments/${paymentId}`,
      {
        headers: {
          'Authorization': `Bearer ${PAYWAY_API_KEY}`,
        },
      }
    );

    const { status, amount, email, payment_method } = paywayResponse.data;

    res.json({
      payment_id: paymentId,
      status: status, // 'approved', 'pending', 'rejected'
      amount: amount,
      email: email,
      payment_method: payment_method,
    });

  } catch (error) {
    console.error('Error verificando pago:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error al verificar el pago' });
  }
});

// ========== ENVIAR CORREO (opcional) ==========
app.post('/api/send-payment-email', async (req, res) => {
  try {
    const { email, amount, paymentId } = req.body;
    const mailOptions = {
      from: `"Cajero Emprender" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '✅ Pago Recibido - Cajero Emprender',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>¡Pago confirmado!</h2>
          <p>Tu pago de <strong>₲${Number(amount).toLocaleString()}</strong> ha sido procesado exitosamente.</p>
          <p>ID de pago: <code>${paymentId}</code></p>
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (error) {
    console.error('Error enviando correo:', error);
    res.status(500).json({ error: 'Error al enviar correo' });
  }
});

// ========== INICIAR SERVIDOR ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor Payway corriendo en puerto ${PORT}`);
});
