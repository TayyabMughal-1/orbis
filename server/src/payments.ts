import { REGIONS, type RegionCode } from '../../src/regions/config.js'
import { badRequest } from './errors.js'

// ---------------------------------------------------------------------
// Payments.
//
// This is the seam where a real gateway plugs in, and the reason it has
// to live on the server: every one of these needs a secret key that must
// never reach a browser.
//
// What happens today, honestly:
//   • Offline methods (cash on delivery, bank transfer) are fully
//     handled — there is no gateway involved, the order is simply
//     recorded as payable later. Those flows are complete.
//   • Card and wallet methods create the order with payment_status
//     'pending'. No money moves. The storefront says so on the
//     confirmation page rather than claiming a payment succeeded.
//
// To go live, implement the provider for a market and return
// 'paid' (or a redirect URL for the flows that need one).
// ---------------------------------------------------------------------

export type PaymentStatus = 'paid' | 'pending' | 'due_on_delivery'

export type PaymentResult = {
  status: PaymentStatus
  /** Gateway reference, once there is a gateway. */
  reference: string | null
  /** Where to send the customer next, for redirect-based methods. */
  redirectUrl: string | null
  /** Shown on the confirmation page. */
  instructions: string | null
}

/** Methods that are genuinely complete without a gateway. */
const OFFLINE_METHODS = new Set(['cod', 'bank'])

export async function authorizePayment(input: {
  region: RegionCode
  methodId: string
  amount: number
  currency: string
  orderEmail: string
}): Promise<PaymentResult> {
  const config = REGIONS[input.region]
  const method = config.paymentMethods.find((m) => m.id === input.methodId)

  if (!method) {
    throw badRequest(
      'payment_invalid',
      `${input.methodId} is not an accepted payment method in the ${config.country} store.`,
    )
  }

  if (OFFLINE_METHODS.has(method.id)) {
    return {
      status: 'due_on_delivery',
      reference: null,
      redirectUrl: null,
      instructions:
        method.id === 'bank'
          ? `Bank details have been sent to ${input.orderEmail}. Quote your order number on the transfer.`
          : 'Please have the exact amount ready for the courier.',
    }
  }

  // ------------------------------------------------------------------
  // Live gateways go here. Sketches, per market:
  //
  //   us: const intent = await stripe.paymentIntents.create({
  //         amount: input.amount,            // already in minor units
  //         currency: input.currency.toLowerCase(),
  //         automatic_payment_methods: { enabled: true },
  //       })
  //       return { status: 'pending', reference: intent.id,
  //                redirectUrl: null, instructions: null }
  //       ...then confirm client-side and settle on the webhook.
  //
  //   ae: Network International / Telr / Checkout.com hosted page, or
  //       Tabby and Tamara, which are redirect flows that call a webhook
  //       on approval.
  //
  //   pk: Easypaisa and JazzCash merchant APIs — both redirect the
  //       customer and post back a signed result.
  //
  // Whatever the provider, the rule holds: the amount comes from the
  // server's own quote, never from the request body.
  // ------------------------------------------------------------------

  return {
    status: 'pending',
    reference: null,
    redirectUrl: null,
    instructions:
      'This deployment has no live payment gateway configured, so no card has been charged. ' +
      'Your order is recorded and our team will be in touch to arrange payment.',
  }
}

export function isOffline(methodId: string): boolean {
  return OFFLINE_METHODS.has(methodId)
}
