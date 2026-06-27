/**
 * Copy text to the clipboard, reliably — even over plain HTTP.
 *
 * The modern `navigator.clipboard` API only works in a "secure context"
 * (HTTPS or localhost). When the console is opened over a plain
 * `http://<server-ip>:3000` address it is NOT a secure context, so the modern
 * API is either missing or throws (in Safari/WebKit the error reads
 * "The string did not match the expected pattern.").
 *
 * So we try the modern API first, and fall back to the old
 * `document.execCommand("copy")` trick with a hidden textarea, which works in
 * insecure contexts and older browsers.
 *
 * Returns `true` if the copy succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. Modern API — only in a secure context, where it's allowed.
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy method
    }
  }

  // 2. Legacy fallback — works over plain HTTP.
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Keep it off-screen and non-disruptive.
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
