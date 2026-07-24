import 'server-only'

/**
 * Provider account discovery — the "Validate & Pick" connect flow.
 *
 * Instead of making users copy sender numbers and Messaging Service
 * SIDs out of the Twilio console, we validate the credentials once and
 * fetch everything the account owns so the UI can offer pickers:
 *   - account friendly name (proves the credentials work)
 *   - incoming phone numbers with capabilities (SMS senders)
 *   - WhatsApp-enabled senders (Messaging v2 Channels API)
 *   - Messaging Services (recommended for SMS pooling/opt-out)
 *
 * Credentials are used server-side only and never persisted here —
 * saving still goes through the existing encrypted save path.
 */

export interface DiscoveredNumber {
  phoneNumber: string
  label: string
  smsCapable: boolean
}

export interface DiscoveredMessagingService {
  sid: string
  name: string
}

export interface TwilioDiscovery {
  accountName: string
  numbers: DiscoveredNumber[]
  whatsappSenders: string[]
  messagingServices: DiscoveredMessagingService[]
}

class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'DiscoveryError'
  }
}

async function twilioGet(url: string, accountSid: string, authToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
    },
    // Discovery is a live lookup; never cache provider inventory.
    cache: 'no-store',
  })
  if (response.status === 401) {
    throw new DiscoveryError('Twilio rejected these credentials. Check the Account SID and Auth token.', 401)
  }
  if (!response.ok) {
    throw new DiscoveryError(`Twilio request failed (${response.status})`, response.status)
  }
  return (await response.json()) as Record<string, unknown>
}

export async function discoverTwilioAccount(accountSid: string, authToken: string): Promise<TwilioDiscovery> {
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
    throw new DiscoveryError('Account SID must look like AC… (34 characters).', 400)
  }

  // 1. Validate credentials + get the account's friendly name.
  const account = await twilioGet(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
    accountSid,
    authToken,
  )

  // 2. Owned phone numbers with capabilities.
  const numbersPayload = await twilioGet(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PageSize=100`,
    accountSid,
    authToken,
  )
  const rawNumbers = Array.isArray(numbersPayload.incoming_phone_numbers)
    ? (numbersPayload.incoming_phone_numbers as Record<string, unknown>[])
    : []
  const numbers: DiscoveredNumber[] = rawNumbers.map((row) => {
    const capabilities = (row.capabilities ?? {}) as Record<string, unknown>
    return {
      phoneNumber: String(row.phone_number ?? ''),
      label: String(row.friendly_name ?? row.phone_number ?? ''),
      smsCapable: capabilities.sms === true || capabilities.SMS === true,
    }
  })

  // 3. WhatsApp senders (Messaging v2 Channels). Not every account has
  //    access to this API — treat failure as "no registered senders",
  //    the UI then falls back to the full number list.
  let whatsappSenders: string[] = []
  try {
    const sendersPayload = await twilioGet(
      'https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=50',
      accountSid,
      authToken,
    )
    const senders = Array.isArray(sendersPayload.senders) ? (sendersPayload.senders as Record<string, unknown>[]) : []
    whatsappSenders = senders
      .map((sender) => String(sender.sender_id ?? '').replace(/^whatsapp:/, ''))
      .filter(Boolean)
  } catch {
    whatsappSenders = []
  }

  // 4. Messaging Services (optional, recommended for SMS).
  let messagingServices: DiscoveredMessagingService[] = []
  try {
    const servicesPayload = await twilioGet('https://messaging.twilio.com/v1/Services?PageSize=50', accountSid, authToken)
    const services = Array.isArray(servicesPayload.services) ? (servicesPayload.services as Record<string, unknown>[]) : []
    messagingServices = services.map((service) => ({
      sid: String(service.sid ?? ''),
      name: String(service.friendly_name ?? service.sid ?? ''),
    }))
  } catch {
    messagingServices = []
  }

  return {
    accountName: String(account.friendly_name ?? accountSid),
    numbers,
    whatsappSenders,
    messagingServices,
  }
}

export function isDiscoveryError(error: unknown): error is DiscoveryError {
  return error instanceof Error && error.name === 'DiscoveryError'
}
