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

app.get('/api/stripe-key', (req, res) => {
  // Asegúrate de que STRIPE_SECRET_KEY esté en tus variables de entorno (Render)
  const publishableKey = process.env.STRIPE_SECRET_KEY;

  if (!publishableKey) {
    return res.status(500).json({ error: 'Stripe publishable key no configurada' });
  }

  res.json({ publishableKey });
});

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    message: 'Backend de Stripe para Cajero Emprender',
    status: 'online',
    endpoints: {
      createVendorAccount: 'POST /api/create-vendor-account',
      vendorOnboarding: 'GET /api/vendor-onboarding/:vendor_id',
      createPaymentIntent: 'POST /api/create-payment-intent',
      createSubscription: 'POST /api/create-subscription',
      sendVendorEmail: 'POST /api/send-vendor-email',
    }
  });
});

// ========== CREAR CUENTA CONNECT PARA VENDEDOR ==========
app.post('/api/create-vendor-account', async (req, res) => {
  try {
    const { email, name, phone } = req.body;

    const account = await stripe.accounts.create({
      type: 'standard',
      country: 'US',
      email: email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      // ✅ Sin business_type ni individual (evita errores)
    });

    res.json({ 
      vendor_id: account.id,
      account_url: account.url
    });
  } catch (error) {
    console.error('Error creando cuenta vendedor:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== ENVIAR CORREO CON vendorId ==========
app.post('/api/send-vendor-email', async (req, res) => {
  try {
    const { email, vendorId, name } = req.body;

    if (!email || !vendorId || !name) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const mailOptions = {
      from: `"Cajero Emprender" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '✅ ¡Tu cuenta de vendedor ha sido creada!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1976d2;">¡Bienvenido, ${name}!</h2>
          <p>Tu cuenta de vendedor en <strong>Cajero Emprender</strong> ha sido creada exitosamente.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><strong>ID de vendedor:</strong></p>
            <p style="font-family: monospace; background: white; padding: 10px; border-radius: 4px; word-break: break-all;">
              ${vendorId}
            </p>
          </div>

          <p>Guarda este ID en un lugar seguro. Lo necesitarás para:</p>
          <ul>
            <li>Verificar el estado de tu cuenta</li>
            <li>Resolver problemas técnicos</li>
            <li>Recibir asistencia personalizada</li>
          </ul>

          <p><strong>Próximos pasos:</strong></p>
          <ol>
            <li>Completa tu configuración bancaria</li>
            <li>Empieza a crear tus productos</li>
            <li>¡Recibe pagos directamente en tu cuenta!</li>
          </ol>

          <hr style="margin: 30px 0;">
          <p style="color: #666; font-size: 12px;">
            Este es un mensaje automático. Por favor, no respondas a este correo.
          </p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Correo enviado exitosamente' });
  } catch (error) {
    console.error('Error enviando correo:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== OBTENER ENLACE DE ONBOARDING ==========
app.get('/api/vendor-onboarding/:vendor_id', async (req, res) => {
  try {
    const { vendor_id } = req.params;
    
    const accountLink = await stripe.accountLinks.create({
      account: vendor_id,
      refresh_url: `${process.env.APP_DOMAIN}/vendor/reauth`,
      return_url: `${process.env.APP_DOMAIN}/vendor/complete`,
      type: 'account_onboarding',
      collect: 'currently_due',
    });
    
    res.json({ url: accountLink.url });
  } catch (error) {
    console.error('Error en onboarding:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== CREAR PAYMENT INTENT PARA CAJA ==========
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { 
      amount,
      vendor_id,
      currency = 'usd',
      description = 'Pago en Cajero Emprender',
      is_subscription = false,
      payment_method_id, // ← Añadir esta línea
      customer_id,       // ← Opcional, pero recomendado
    } = req.body;

    const amountInCents = typeof amount === 'number' ? amount : Math.round(amount * 100);

    // Para suscripciones, no usamos payment_method aquí (se maneja aparte)
    if (is_subscription) {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: currency,
        description: description,
        statement_descriptor: 'CAJERO SUB',
      });
      
      return res.json({
        id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        status: paymentIntent.status,
      });
    }

    // Configuración base del PaymentIntent
    const intentParams = {
      amount: amountInCents,
      currency: currency,
      description: description,
      statement_descriptor: 'CAJERO EMPRENDER',
      // 🔑 Clave para poder confirmar después desde el frontend
      confirmation_method: 'manual',
      confirm: false,
    };

    // Si viene un payment_method_id, lo asignamos
    if (payment_method_id) {
      intentParams.payment_method = payment_method_id;
    }

    // Si viene customer_id, lo asignamos
    if (customer_id) {
      intentParams.customer = customer_id;
    }

    // Si es pago con vendedor (Stripe Connect)
    if (vendor_id) {
      const commission_rate = 0.05;
      const application_fee = Math.max(50, Math.round(amountInCents * commission_rate));
      intentParams.application_fee_amount = application_fee;
      intentParams.transfer_data = { destination: vendor_id };
    }

    const paymentIntent = await stripe.paymentIntents.create(intentParams);

    res.json({
      id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      status: paymentIntent.status,
    });
  } catch (error) {
    console.error('Error creando PaymentIntent:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== CREAR SUSCRIPCIÓN ==========
app.post('/api/create-subscription', async (req, res) => {
  try {
    const { customer_id, price_id, vendor_id } = req.body;
    const subscription = await stripe.subscriptions.create({
      customer: customer_id,
      items: [{ price: price_id }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    res.json({
      subscription_id: subscription.id,
      client_secret: subscription.latest_invoice.payment_intent.client_secret,
    });
  } catch (error) {
    console.error('Error creando suscripción:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== VERIFICAR ESTADO DE CUENTA VENDEDOR ==========
app.get('/api/vendor-status/:vendor_id', async (req, res) => {
  try {
    const { vendor_id } = req.params;
    const account = await stripe.accounts.retrieve(vendor_id);
    
    res.json({
      charges_enabled: account.charges_enabled,
      transfers_enabled: account.transfers_enabled,
      details_submitted: account.details_submitted,
      requirements: account.requirements?.errors || [],
    });
  } catch (error) {
    console.error('Error verificando estado vendedor:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== CREAR CUSTOMER ==========
app.post('/api/create-customer', async (req, res) => {
  try {
    const { email, name, phone, metadata } = req.body;
    const customer = await stripe.customers.create({ 
      email, 
      name, 
      phone, 
      metadata: metadata || {} 
    });
    res.json({ customer_id: customer.id });
  } catch (error) {
    console.error('Error creando customer:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== GUARDAR MÉTODO DE PAGO ==========
app.post('/api/save-payment-method', async (req, res) => {
  try {
    const { customer_id, payment_method_id } = req.body;
    await stripe.paymentMethods.attach(payment_method_id, { customer: customer_id });
    await stripe.customers.update(customer_id, {
      invoice_settings: { default_payment_method: payment_method_id },
    });
    res.json({ payment_method_id });
  } catch (error) {
    console.error('Error guardando método de pago:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== LISTAR MÉTODOS DE PAGO ==========
app.get('/api/payment-methods/:customer_id', async (req, res) => {
  try {
    const { customer_id } = req.params;
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer_id,
      type: 'card',
    });
    const methods = paymentMethods.data.map(pm => ({
      id: pm.id,
      type: pm.type,
      last4: pm.card.last4,
      brand: pm.card.brand,
      exp_month: pm.card.exp_month,
      exp_year: pm.card.exp_year,
    }));
    res.json(methods);
  } catch (error) {
    console.error('Error listando métodos de pago:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== VERIFICAR ESTADO DE PAGO ==========
app.get('/api/payment-status/:payment_intent_id', async (req, res) => {
  try {
    const { payment_intent_id } = req.params;
    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    res.json({
      status: paymentIntent.status,
      message: _getStatusMessage(paymentIntent.status),
    });
  } catch (error) {
    console.error('Error verificando estado:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== UTILIDADES ==========
function _getStatusMessage(status) {
  const messages = {
    succeeded: 'Pago completado exitosamente',
    processing: 'Pago en procesamiento',
    requires_payment_method: 'Requiere método de pago',
    requires_confirmation: 'Requiere confirmación',
    requires_action: 'Requiere acción del cliente',
    canceled: 'Pago cancelado',
    failed: 'Pago fallido',
  };
  return messages[status] || 'Estado desconocido';
}

// ========== PÁGINA DE REDIRECCIÓN ==========
app.get('/onboarding-completo', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Onboarding Completado</title>
        <style>
            body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; }
            .icon { font-size: 48px; color: #4CAF50; margin-bottom: 1rem; }
            h1 { color: #333; margin: 0 0 0.5rem 0; font-size: 1.5rem; }
            p { color: #666; margin: 0 0 1.5rem 0; font-size: 14px; }
            .note { background: #e8f5e8; padding: 0.75rem; border-radius: 8px; font-size: 12px; color: #2e7d32; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">✅</div>
            <h1>¡Onboarding completado!</h1>
            <p>Tu cuenta de Stripe Connect ha sido configurada exitosamente.</p>
            <div class="note">
                Si estás en una ventana emergente, se cerrará automáticamente.<br>
                De lo contrario, puedes cerrar esta pestaña.
            </div>
        </div>
        <script>
            if (window.opener && window.opener !== window) {
                window.close();
            }
        </script>
    </body>
    </html>
  `);
});

// ========== INICIAR SERVIDOR ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});
