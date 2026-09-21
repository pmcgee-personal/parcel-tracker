// Retry helper with exponential backoff for transient failures (5xx, 429,
// and network errors) calling out to ShipEngine. Shared by track and delete,
// which were previously two verbatim-identical copies of this function.
async function fetchWithRetry(url, options, maxAttempts = 3) {
  const delays = [1000, 2000, 4000]; // 1s, 2s, 4s

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);

      // Success - return the response
      if (response.ok) {
        return response;
      }

      // Retry on 5xx errors (server errors) and 429 (rate limit)
      const isRetryable = response.status >= 500 || response.status === 429;
      if (!isRetryable || attempt === maxAttempts - 1) {
        // Non-retryable error or last attempt - return the error response
        return response;
      }

      console.warn(
        `[fetchWithRetry] Attempt ${attempt + 1} failed with ${response.status}, retrying in ${delays[attempt]}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    } catch (error) {
      // Network error - retry if not the last attempt
      if (attempt === maxAttempts - 1) {
        throw error;
      }

      console.warn(
        `[fetchWithRetry] Attempt ${attempt + 1} failed with network error, retrying in ${delays[attempt]}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

module.exports = { fetchWithRetry };
