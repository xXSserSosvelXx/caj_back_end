// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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
      // ... otros endpoints
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
      // ✅ Elimina business_type e individual
      // Stripe los recoge en el onboarding
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
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

// ========== CREAR PAYMENT INTENT PARA CAJA (CON COMISIÓN 5%) ==========
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { 
      amount,           // Monto total en centavos
      vendor_id,        // ID del vendedor (opcional)
      currency = 'usd', // Siempre USD para Connect
      description = 'Pago en Cajero Emprender',
      is_subscription = false // Indica si es suscripción
    } = req.body;

    // Convertir a centavos si es necesario
    const amountInCents = typeof amount === 'number' ? amount : Math.round(amount * 100);

    // Configuración para suscripciones (100% a tu cuenta)
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

    // Configuración para caja (5% comisión, 95% al vendedor)
    if (vendor_id) {
      const commission_rate = 0.05; // 5%
      const application_fee = Math.max(50, Math.round(amountInCents * commission_rate)); // Mínimo 50 centavos
      const vendor_amount = amountInCents - application_fee;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: currency,
        application_fee_amount: application_fee,
        transfer_data: {
          destination: vendor_id,
        },
        description: description,
        statement_descriptor: 'CAJERO EMPRENDER',
      });

      return res.json({
        id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        status: paymentIntent.status,
        vendor_amount: vendor_amount,
        commission: application_fee,
      });
    }

    // Si no hay vendor_id, pago va 100% a tu cuenta
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency,
      description: description,
      statement_descriptor: 'CAJERO EMPRENDER',
    });

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

// ========== CREAR SUSCRIPCIÓN (100% A TU CUENTA) ==========
app.post('/api/create-subscription', async (req, res) => {
  try {
    const { 
      customer_id, 
      price_id, 
      vendor_id // Opcional, pero para suscripciones va 100% a ti
    } = req.body;

    // Crear suscripción directamente en tu cuenta (no usa Connect)
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

// ========== ENDPOINTS EXISTENTES (sin cambios) ==========
// Mantén todos tus endpoints actuales para:
// - create-customer
// - save-payment-method  
// - list-payment-methods
// - payment-status

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

// ========== PÁGINA DE REDIRECCIÓN POST-ONBOARDING ==========
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
