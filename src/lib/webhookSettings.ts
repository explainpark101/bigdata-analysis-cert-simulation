import { idbGet, idbSet } from '@/lib/idb';

export interface WebhookSettings {
  /** Discord incoming webhook URL. Empty = disabled. */
  discordWebhookUrl: string;
}

export const EMPTY_WEBHOOK_SETTINGS: WebhookSettings = {
  discordWebhookUrl: '',
};

export function normalizeWebhookSettings(
  raw: unknown,
): WebhookSettings {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_WEBHOOK_SETTINGS };
  const url =
    typeof (raw as WebhookSettings).discordWebhookUrl === 'string'
      ? (raw as WebhookSettings).discordWebhookUrl.trim()
      : '';
  return { discordWebhookUrl: url };
}

export async function loadWebhookSettings(): Promise<WebhookSettings> {
  try {
    const stored = await idbGet<unknown>('webhookSettings');
    return normalizeWebhookSettings(stored);
  } catch {
    return { ...EMPTY_WEBHOOK_SETTINGS };
  }
}

export async function saveWebhookSettings(
  settings: WebhookSettings,
): Promise<void> {
  await idbSet('webhookSettings', normalizeWebhookSettings(settings));
}

/** True when the URL looks like a Discord webhook endpoint. */
export function isDiscordWebhookUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    return (
      /discord(?:app)?\.com$/i.test(parsed.hostname) &&
      /\/api\/webhooks\/\d+\/[\w-]+/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}
