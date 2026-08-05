import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

// Generate a secure 32-byte key from JWT_SECRET using SHA-256
const getEncryptionKey = () => {
  const secret = process.env.JWT_SECRET || 'super-secure-neon-quantum-jwt-secret-key-9824';
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypts a 128-float array (descriptor) before database storage.
 * @param {Array<number>} descriptorArray 
 * @returns {string} Encrypted string in format iv:encryptedData
 */
export const encryptDescriptor = (descriptorArray) => {
  if (!Array.isArray(descriptorArray) || descriptorArray.length === 0) {
    throw new Error('Biometric data must be a valid float array.');
  }
  const text = JSON.stringify(descriptorArray);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return `${iv.toString('hex')}:${encrypted}`;
};

/**
 * Decrypts an encrypted biometric string back to a 128-float array.
 * Supports a graceful fallback to unencrypted JSON arrays for database seed records.
 * @param {string} encryptedString 
 * @returns {Array<number>|null}
 */
export const decryptDescriptor = (encryptedString) => {
  if (!encryptedString) return null;
  
  // Fallback for raw JSON array representation
  const trimmed = encryptedString.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      console.error('[BIOMETRIC DECRYPTION FALLBACK ERROR]: Failed parsing unencrypted JSON:', e);
      return null;
    }
  }

  try {
    const parts = trimmed.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid cipher format. Expected iv:data');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('[BIOMETRIC DECRYPTION ERROR]: Critical failure during decryption:', error);
    throw new Error('Failed to decrypt biometric signature.');
  }
};
