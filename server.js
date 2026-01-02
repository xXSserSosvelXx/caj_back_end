// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de correo
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ✅ CORREGIDO: Devuelve la clave PÚBLICA
app.get('/api/stripe-key', (req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY; // ← NO la secreta
  if (!publishableKey) {
    return res.status(500).json({ error: 'Clave pública no configurada' });
  }
  res.json({ publishableKey });
});

// Ruta raíz
app.get('/', (req, res) => {
  res.json({ message: 'Backend funcionando con Stripe Connect' });
});

// ========== CREAR CUENTA VENDEDOR (PARAGUAY) ==========
app.post('/api/create-vendor-account', async (req, res) => {
  try {
    const { email, name, phone } = req.body;
    const account = await stripe.accounts.create({
      type: 'standard',
      country: 'PY', // ✅ Corregido a Paraguay
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    res.json({ vendor_id: account.id });
  } catch (error) {
    console.error('Error creando cuenta vendedor:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== CREAR PAYMENT INTENT (CON COMISIÓN) ==========
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { 
      amount,              // En guaraníes (₲)
      vendor_id,           // ID del vendedor (destino)
      payment_method_id,   // ID del método de pago
      customer_id,         // ID del cliente en Stripe
      description = 'Pago en Cajero Emprender',
    } = req.body;

    // Convertir ₲ → USD (ej: 1 USD = 7.500 ₲ → ajusta según tasa)
    const exchangeRate = 7500; // ⚠️ Usa una tasa dinámica en producción
    const amountUSD = Math.round(amount / exchangeRate);
    const amountInCents = amountUSD * 100;

    // Comisión del 5%
    const commission = Math.max(50, Math.round(amountInCents * 0.05));
    const vendorAmount = amountInCents - commission;

    // Configuración del PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      payment_method: payment_method_id,
      customer: customer_id,
      confirmation_method: 'manual',
      confirm: false, // ← Se confirma desde el frontend
      description,
      application_fee_amount: commission,
      ...(vendor_id && {
        transfer_data: { destination: vendor_id },
      }),
    });

    res.json({
      id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error('Error creando PaymentIntent:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== WEBHOOK PARA PAGOS EXITOSOS ==========
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Manejar eventos
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log('✅ Pago exitoso:', paymentIntent.id);
    
    // Aquí puedes:
    // 1. Actualizar tu base de datos
    // 2. Notificar al vendedor
    // 3. Enviar factura por email
  }

  res.json({ received: true });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
