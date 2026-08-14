const isTransientError = (error) => {
  if (!error) return false;

  const errorCode = error.code || error.name || "";
  const statusCode = error.$metadata?.httpStatusCode;

  // HTTP 429 (rate limit) and 5xx (server errors) are transient
  if (statusCode === 429 || (statusCode >= 500 && statusCode < 600)) {
    return true;
  }

  // Specific DynamoDB transient errors
  const transientCodes = [
    "ThrottlingException",
    "ProvisionedThroughputExceededException",
    "RequestLimitExceeded",
    "TransactionConflictException",
    "InternalFailure",
    "ServiceUnavailable",
  ];

  return transientCodes.includes(errorCode);
};

const getErrorType = (error) => {
  if (!error) return "UnknownError";
  return error.code || error.name || error.constructor.name || "UnknownError";
};

async function withRetry(
  operation,
  docClient,
  params,
  {
    maxAttempts = 5,
    baseDelayMs = 100,
    requestId = "unknown",
    operationName = "DDBOperation",
  } = {},
) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await docClient.send(operation);
      return {
        success: true,
        data,
        attempt,
        errorType: null,
        isTransient: false,
      };
    } catch (error) {
      lastError = error;
      const errorType = getErrorType(error);
      const isTransient = isTransientError(error);

      // For ConditionalCheckFailedException, only log as info if it's an expected OFD dedup
      // (this will be determined by caller context - we just return the error)
      if (errorType === "ConditionalCheckFailedException") {
        return {
          success: false,
          data: null,
          error,
          errorType,
          attempt,
          isTransient: false,
        };
      }

      // If permanent error, fail immediately
      if (!isTransient) {
        console.error(
          `[${requestId}] op=${operationName} attempt=${attempt} error=${errorType} type=permanent status=failed`,
        );
        return {
          success: false,
          data: null,
          error,
          errorType,
          attempt,
          isTransient: false,
        };
      }

      // If last attempt with transient error, fail
      if (attempt === maxAttempts) {
        console.error(
          `[${requestId}] op=${operationName} attempt=${attempt} error=${errorType} type=transient status=exhausted`,
        );
        return {
          success: false,
          data: null,
          error,
          errorType,
          attempt,
          isTransient: true,
        };
      }

      // Calculate backoff: exponential with 100ms base
      const backoffMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `[${requestId}] op=${operationName} attempt=${attempt} error=${errorType} type=transient delay=${backoffMs}ms`,
      );

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  // Should not reach here, but handle as safety net
  return {
    success: false,
    data: null,
    error: lastError,
    errorType: lastError ? getErrorType(lastError) : "UnknownError",
    attempt: maxAttempts,
    isTransient: lastError ? isTransientError(lastError) : false,
  };
}

module.exports = { withRetry, isTransientError, getErrorType };
