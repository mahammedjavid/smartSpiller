/** Clipboard with a fallback for browsers that block the async API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand?.('copy') ?? false;
    field.remove();
    return ok;
  }
}

/** Native share sheet where available, WhatsApp otherwise (FR-SHARE-2). */
export async function shareOrWhatsApp(title: string, text: string, url: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch {
      return; // user dismissed the sheet — not an error
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener');
}
