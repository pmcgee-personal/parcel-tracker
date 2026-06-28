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
