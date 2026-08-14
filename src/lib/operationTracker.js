class OperationTracker {
  constructor(requestId, trackingNumber) {
    this.requestId = requestId;
    this.trackingNumber = trackingNumber;

    // Track fetch (GetCommand) result
    this.fetchResult = {
      success: null,
      error: null,
      errorType: null,
      attempt: null,
      isTransient: null,
    };

    // Track update (UpdateCommand) result
    this.updateResult = {
      success: null,
      error: null,
      errorType: null,
      attempt: null,
      isTransient: null,
    };

    // Track individual event write results
    this.eventResults = [];
  }

  recordFetch(success, error = null, attempt = null, errorType = null, isTransient = null) {
    this.fetchResult = {
      success,
      error,
      errorType,
      attempt,
      isTransient,
    };
  }

  recordUpdate(success, error = null, attempt = null, errorType = null, isTransient = null) {
    this.updateResult = {
      success,
      error,
      errorType,
      attempt,
      isTransient,
    };
  }

  recordEventWrite(eventIndex, success, error = null, attempt = null, errorType = null, isTransient = null) {
    // Ensure the array is large enough
    while (this.eventResults.length <= eventIndex) {
      this.eventResults.push(null);
    }

    this.eventResults[eventIndex] = {
      index: eventIndex,
      success,
      error,
      errorType,
      attempt,
      isTransient,
    };
  }

  getSummary() {
    const eventSuccessCount = this.eventResults.filter(
      (r) => r && r.success,
    ).length;
    const eventFailureCount = this.eventResults.filter(
      (r) => r && !r.success,
    ).length;
    const eventTransientFailures = this.eventResults.filter(
      (r) => r && !r.success && r.isTransient,
    ).length;
    const eventPermanentFailures = this.eventResults.filter(
      (r) => r && !r.success && !r.isTransient,
    ).length;

    return {
      requestId: this.requestId,
      trackingNumber: this.trackingNumber,
      fetchResult: this.fetchResult,
      updateResult: this.updateResult,
      eventResults: this.eventResults.filter((r) => r !== null),
      summary: {
        fetchSucceeded: this.fetchResult.success,
        updateSucceeded: this.updateResult.success,
        totalEvents: this.eventResults.filter((r) => r !== null).length,
        eventSuccesses: eventSuccessCount,
        eventFailures: eventFailureCount,
        transientFailures: eventTransientFailures,
        permanentFailures: eventPermanentFailures,
      },
    };
  }

  hadFailures() {
    return (
      !this.fetchResult.success ||
      !this.updateResult.success ||
      this.eventResults.some((r) => r && !r.success)
    );
  }

  hadTransientFailures() {
    return (
      (this.fetchResult.success === false && this.fetchResult.isTransient) ||
      (this.updateResult.success === false && this.updateResult.isTransient) ||
      this.eventResults.some((r) => r && !r.success && r.isTransient)
    );
  }

  hadPermanentFailures() {
    return (
      (this.fetchResult.success === false && !this.fetchResult.isTransient) ||
      (this.updateResult.success === false && !this.updateResult.isTransient) ||
      this.eventResults.some((r) => r && !r.success && !r.isTransient)
    );
  }
}

module.exports = { OperationTracker };
