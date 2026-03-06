import Stripe from 'stripe';
import { CONFIG } from './config';
import { updateLead, getLead } from './leads';

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!CONFIG.stripeSecretKey) throw new Error('STRIPE_SECRET_KEY not configured');
    stripe = new Stripe(CONFIG.stripeSecretKey);
  }
  return stripe;
}

export async function createCheckoutSession(
  email: string,
  successUrl: string,
  cancelUrl: string,
): Promise<{ url: string }> {
  const s = getStripe();

  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer_email: email,
    line_items: [{ price: CONFIG.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { email },
  });

  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return { url: session.url };
}

export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string,
): Promise<void> {
  const s = getStripe();

  const event = s.webhooks.constructEvent(
    rawBody,
    signature,
    CONFIG.stripeWebhookSecret,
  );

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.metadata?.email ?? session.customer_email;
    if (!email) return;

    await updateLead(email, {
      plan: 'pro',
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : undefined,
    });
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    if (!customerId) return;

    // Find lead by customer ID — check metadata or do a lookup
    const customer = await s.customers.retrieve(customerId) as Stripe.Customer;
    const email = customer.email;
    if (email) {
      await updateLead(email, { plan: undefined, stripeSubscriptionId: undefined });
    }
  }
}

export async function getSubscriptionStatus(email: string): Promise<{ plan: string; active: boolean }> {
  const lead = await getLead(email);
  if (!lead?.plan || lead.plan === 'free') return { plan: 'free', active: false };
  return { plan: lead.plan, active: true };
}
