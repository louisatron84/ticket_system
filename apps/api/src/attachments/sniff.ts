// What a file really is, read from its first bytes. The name and the type the browser claimed are
// never trusted: an SVG or HTML page renamed to `.png` is still refused, because it is not a PNG.

export type DetectedType = {
  contentType: string;
  /** Shown inline as a thumbnail; everything else is only ever downloaded. */
  image: boolean;
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

/** Text kinds accepted when the content is plain UTF-8 text, keyed by file extension. */
const TEXT_TYPES: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
};

function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  // Markup in a text file is refused too, so nothing that a browser would treat as a page slips in.
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart().toLowerCase();
  return !/^<(!doctype|html|svg|\?xml|script|head|body|iframe)/.test(head);
}

/** The file's real type, or null when it is not one Forge accepts. */
export function detectType(bytes: Uint8Array, fileName: string): DetectedType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: 'image/png', image: true };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { contentType: 'image/jpeg', image: true };
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) {
    return { contentType: 'image/gif', image: true };
  }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
    return { contentType: 'image/webp', image: true };
  }
  if (startsWith(bytes, ascii('%PDF-'))) return { contentType: 'application/pdf', image: false };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return { contentType: 'application/zip', image: false };
  }
  const extension = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  const textType = TEXT_TYPES[extension];
  if (textType && isPlainText(bytes)) return { contentType: textType, image: false };
  return null;
}

/** The raster image types Forge may show inline. */
export const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
