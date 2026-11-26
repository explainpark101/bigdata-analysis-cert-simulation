import { isDiscordWebhookUrl, loadWebhookSettings } from '@/lib/webhookSettings';

const DISCORD_FILE_LIMIT = 20 * 1024 * 1024; // 20 MiB default

export interface DiscordUploadResult {
  ok: boolean;
  skipped?: boolean;
  message: string;
}

/**
 * POST one file to a Discord incoming webhook (multipart).
 * Uses global fetch (Tauri proxy bypasses CORS in the desktop app).
 */
export async function uploadFileToDiscordWebhook(opts: {
  webhookUrl: string;
  filename: string;
  blob: Blob;
  content?: string;
  signal?: AbortSignal;
}): Promise<DiscordUploadResult> {
  const url = opts.webhookUrl.trim();
  if (!url) {
    return { ok: true, skipped: true, message: 'Webhook URL empty' };
  }
  if (!isDiscordWebhookUrl(url)) {
    return {
      ok: false,
      message: 'Discord webhook URL 형식이 올바르지 않습니다.',
    };
  }
  if (opts.blob.size > DISCORD_FILE_LIMIT) {
    return {
      ok: false,
      message: `파일이 Discord 한도(20MiB)를 초과합니다: ${opts.filename}`,
    };
  }

  const form = new FormData();
  const content = (opts.content ?? opts.filename).slice(0, 1900);
  form.append(
    'payload_json',
    JSON.stringify({
      content,
      attachments: [{ id: 0, filename: opts.filename }],
    }),
  );
  form.append('files[0]', opts.blob, opts.filename);

  const res = await fetch(url, {
    method: 'POST',
    body: form,
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      message: `Discord 업로드 실패 (${res.status}): ${body.slice(0, 160) || res.statusText}`,
    };
  }

  return { ok: true, message: `업로드됨: ${opts.filename}` };
}

/** No-op when webhook is unset; otherwise upload one file. */
export async function maybeUploadViaWebhook(opts: {
  filename: string;
  blob: Blob;
  content?: string;
  signal?: AbortSignal;
}): Promise<DiscordUploadResult> {
  const settings = await loadWebhookSettings();
  if (!settings.discordWebhookUrl.trim()) {
    return { ok: true, skipped: true, message: 'Webhook 미설정' };
  }
  return uploadFileToDiscordWebhook({
    webhookUrl: settings.discordWebhookUrl,
    filename: opts.filename,
    blob: opts.blob,
    content: opts.content,
    signal: opts.signal,
  });
}
