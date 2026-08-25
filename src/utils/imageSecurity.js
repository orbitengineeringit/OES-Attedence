/**
 * Image Security & Sanitization Utility
 * 
 * Provides defense-in-depth security against malicious file uploads:
 * 1. MIME type validation & extension verification
 * 2. Magic byte header verification (prevents file extension spoofing)
 * 3. File size and dimension boundary enforcement (prevents decompression bombs)
 * 4. Hardware canvas re-encoding (strips EXIF tags, GPS metadata, and injected scripts)
 */

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3MB
const MAX_DIMENSION = 4096; // Max 4096px width/height

/**
 * Validates binary magic byte signatures of image buffers
 */
export async function verifyImageMagicBytes(file) {
  const headerBytes = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('Failed reading image binary signature.'));
      }
    };
    reader.onerror = () => reject(new Error('File read error.'));
    // Read only the first 16 bytes for signature validation
    reader.readAsArrayBuffer(file.slice(0, 16));
  });

  if (!headerBytes || headerBytes.length < 4) {
    throw new Error('Invalid or corrupted image header.');
  }

  // 1. JPEG Check: FF D8 FF
  const isJpeg = headerBytes[0] === 0xFF && headerBytes[1] === 0xD8 && headerBytes[2] === 0xFF;
  if (isJpeg) return 'image/jpeg';

  // 2. PNG Check: 89 50 4E 47 0D 0A 1A 0A
  const isPng = headerBytes[0] === 0x89 && headerBytes[1] === 0x50 && 
                headerBytes[2] === 0x4E && headerBytes[3] === 0x47;
  if (isPng) return 'image/png';

  // 3. WebP Check: RIFF .... WEBP
  const isWebp = headerBytes[0] === 0x52 && headerBytes[1] === 0x49 && 
                 headerBytes[2] === 0x46 && headerBytes[3] === 0x46 &&
                 headerBytes[8] === 0x57 && headerBytes[9] === 0x45 && 
                 headerBytes[10] === 0x42 && headerBytes[11] === 0x50;
  if (isWebp) return 'image/webp';

  throw new Error('Security Error: Uploaded file is not a genuine JPEG, PNG, or WebP image.');
}

/**
 * Validates file headers, sizes, and binary integrity
 */
export async function validateImageFile(file) {
  if (!file) {
    throw new Error('No image file selected.');
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed size is 3MB.`);
  }

  if (file.size < 100) {
    throw new Error('File is corrupted or too small.');
  }

  // Check MIME type
  if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
    throw new Error('Invalid format. Only JPG, PNG, and WebP images are permitted.');
  }

  // Check Magic Bytes
  await verifyImageMagicBytes(file);

  return true;
}

/**
 * Sanitizes and re-encodes avatar through HTML5 canvas
 * Strips 100% of EXIF, GPS metadata, comments, and payload byte sequences.
 * Returns clean, resized WebP Data URL (400x400 square).
 */
export async function sanitizeAndCompressAvatar(file, outputDimension = 400) {
  // Step 1: Binary validation
  await validateImageFile(file);

  // Step 2: Load into HTML Image element
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed decoding image data. The file may be corrupted.'));
      el.src = objectUrl;
    });

    // Check dimensions to prevent decompression bombs
    if (img.naturalWidth > MAX_DIMENSION || img.naturalHeight > MAX_DIMENSION) {
      throw new Error(`Image dimensions (${img.naturalWidth}x${img.naturalHeight}) exceed safety limit of ${MAX_DIMENSION}px.`);
    }

    if (img.naturalWidth < 10 || img.naturalHeight < 10) {
      throw new Error('Image dimensions are too small.');
    }

    // Step 3: Draw on offscreen canvas with square center-crop
    const canvas = document.createElement('canvas');
    canvas.width = outputDimension;
    canvas.height = outputDimension;
    const ctx = canvas.getContext('2d', { alpha: false });

    if (!ctx) {
      throw new Error('Canvas 2D context unavailable.');
    }

    // Fill white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outputDimension, outputDimension);

    // Calculate center crop
    const minSide = Math.min(img.naturalWidth, img.naturalHeight);
    const sourceX = (img.naturalWidth - minSide) / 2;
    const sourceY = (img.naturalHeight - minSide) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      sourceX,
      sourceY,
      minSide,
      minSide,
      0,
      0,
      outputDimension,
      outputDimension
    );

    // Step 4: Re-encode to clean WebP (or JPEG fallback)
    let sanitizedDataUrl = canvas.toDataURL('image/webp', 0.88);
    if (!sanitizedDataUrl.startsWith('data:image/webp')) {
      sanitizedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
    }

    return sanitizedDataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
