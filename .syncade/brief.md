# Webhook Error Handling & Observability Improvement

## Current State

The webhook handler (`src/handlers/webhook/index.js`) currently:

1. **Silent failures on transient errors**: If a DynamoDB `UpdateCommand` or `PutCommand` fails due to a transient network error (e.g., ServiceUnavailable, throttling), the handler dies instead of retrying with backoff.

2. **Minimal structured logging**: Error logs include the request ID but lack context about _which_ operation failed (shipment update vs. event write), the payload subset, or retry attempts.

3. **No distinction between transient and permanent failures**: Both recoverable network hiccups and unrecoverable bad data result in the same 500 response, making it hard to debug in production.

4. **Partial failure ambiguity**: If the shipment metadata update succeeds but an event write fails, we log it but continue silently—unclear whether the webhook should return a partial-failure status or retry the entire payload.

## Goal

Add granular error handling with retry-on-transient patterns for all DynamoDB writes, improve error logging with structured fields (operation name, error code, retry count), and ensure all failure paths return actionable signals to CloudWatch for better observability.

## Acceptance Criteria

- All DDB operations retry with exponential backoff on transient failures (5xx, 429)
- Structured logging with operation name, error type, and attempt count
- Clear distinction in logs/alerts between retryable and non-retryable failures
- No silent partial failures—webhook explicitly reports success/failure for each write
- (Optional but nice) Request deduplication: store request ID in shipment record to avoid re-processing identical webhooks
