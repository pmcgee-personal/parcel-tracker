const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedApiKey = null;
let cachedApiKeyExpiry = 0;

// Fetch and cache the ShipStation API key from Secrets Manager. Cached for
// up to an hour per warm Lambda container, so a rotated key is picked up
// within that window instead of sticking for the container's entire
// lifetime (as an unbounded, never-expiring cache would).
async function getShipStationApiKey(secretName) {
  const now = Date.now();
  if (cachedApiKey && cachedApiKeyExpiry > now) {
    return cachedApiKey;
  }

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    );
    const secret = JSON.parse(response.SecretString);
    if (!secret.ShipStationApiKey) {
      throw new Error(
        `Secret '${secretName}' is missing the 'ShipStationApiKey' field`,
      );
    }
    cachedApiKey = secret.ShipStationApiKey;
    cachedApiKeyExpiry = now + CACHE_TTL_MS;
    return cachedApiKey;
  } catch (error) {
    console.error("Failed to retrieve API key from Secrets Manager:", error);
    throw new Error("Internal Server Error: Unable to retrieve API key");
  }
}

module.exports = { getShipStationApiKey };
