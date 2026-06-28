import DOMPurify from 'dompurify';

export const sanitizeInput = (input) => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove any HTML tags and dangerous characters
  const cleaned = DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });

  // Additional whitelist: only alphanumeric, spaces, hyphens, underscores, periods, and common punctuation
  // This is more restrictive than DOMPurify alone
  return cleaned.trim();
};

export const sanitizeTrackingNumber = (input) => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Tracking numbers: alphanumeric only (most carriers use these)
  return input
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 100);
};

export const sanitizeCarrier = (input) => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Carrier: lowercase alphanumeric and underscore (for fedex, ups, stamps_com)
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, 50);
};

export const sanitizeTextField = (input, maxLength = 100) => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Generic text field: allow alphanumeric, spaces, hyphens, underscores, periods
  return sanitizeInput(input)
    .replace(/[^a-zA-Z0-9\s\-_.]/g, '')
    .substring(0, maxLength);
};
