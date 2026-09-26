export const getStatusStyle = (code) => {
  switch (code) {
    case "IT": // In Transit
    case "AC": // Accepted
      return "bg-cyan-900/40 text-cyan-400 border border-cyan-800/60";
    case "OFD": // Out for Delivery
      return "bg-amber-900/40 text-amber-400 border border-amber-800/60";
    case "DE": // Delivered
      return "bg-emerald-900/40 text-emerald-400 border border-emerald-800/60";
    case "EX": // Exception
      return "bg-rose-900/40 text-rose-400 border border-rose-800/60";
    default: // Unknown, Not Yet in System, etc.
      return "bg-slate-800 text-slate-300 border border-slate-700";
  }
};

// Filter delivery-date history entries down to those whose calendar day
// (in the viewer's local timezone) differs from `currentDate`. Used to find
// the "original" estimated delivery date before any subsequent carrier
// reschedule, ignoring history entries that just repeat the current date.
//
// Buckets by local day (not a raw ISO-string slice) so that two carrier
// timestamps representing the same instant in different formats (e.g. a
// bare "...T17:00:00" and its UTC equivalent "...T00:00:00Z") are never
// mistaken for a real date change, and so this always agrees with the
// local-day comparison DriftIndicator uses to pick the drift direction.
export const filterHistoryExcludingDate = (history, currentDate) => {
  if (!currentDate) return [];
  const currentDay = new Date(currentDate).setHours(0, 0, 0, 0);
  return (history || []).filter((historyItem) => {
    if (!historyItem.date) return false;
    const historyDay = new Date(historyItem.date).setHours(0, 0, 0, 0);
    return historyDay !== currentDay;
  });
};

export const getLabelGeneratedDate = (shipment) => {
  const events = shipment.events || [];

  const labelEvent = events.find((event) => {
    const desc = (event.description || "").toLowerCase();
    return (
      desc.includes("label created") ||
      desc.includes("shipping label created") ||
      desc.includes("shipper created a label") ||
      desc.includes("label has been created") ||
      desc.includes("billing information received")
    );
  });

  if (!labelEvent || !labelEvent.carrierOccurredAt) {
    return null;
  }

  return new Date(labelEvent.carrierOccurredAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};
