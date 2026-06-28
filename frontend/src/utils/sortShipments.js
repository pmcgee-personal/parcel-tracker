// Sort shipments by activity status and date
export const sortShipments = (shipments) => {
  return [...shipments].sort((a, b) => {
    const activeStatuses = ["IT", "EX", "AC", "OFD"];
    const isA_Active = activeStatuses.includes(a.statusCode);
    const isB_Active = activeStatuses.includes(b.statusCode);

    // Active items come first
    if (isA_Active && !isB_Active) return -1;
    if (!isA_Active && isB_Active) return 1;

    // Both active: sort by estimated delivery date ascending (soonest first)
    if (isA_Active && isB_Active) {
      const dateA = a.estimatedDeliveryDate
        ? new Date(a.estimatedDeliveryDate)
        : null;
      const dateB = b.estimatedDeliveryDate
        ? new Date(b.estimatedDeliveryDate)
        : null;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA - dateB;
    }

    // Both delivered: sort by last event activity descending (most recent activity first)
    const timeA = a.lastEventTimestamp
      ? new Date(a.lastEventTimestamp)
      : null;
    const timeB = b.lastEventTimestamp
      ? new Date(b.lastEventTimestamp)
      : null;
    if (!timeA) return 1;
    if (!timeB) return -1;
    return timeB - timeA;
  });
};
