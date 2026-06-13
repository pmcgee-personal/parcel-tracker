import React, { useEffect, useState, useCallback } from "react";
import { timeSince } from "./utils/timeUtils";

const getStatusStyle = (code) => {
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

// --- NEW COMPONENT: Estimated Delivery Date Drift Tracker with Tooltip ---
const EstimatedDeliveryWithHistory = ({ shipment }) => {
  if (!shipment.estimatedDeliveryDate) {
    return <span className="text-slate-500">—</span>;
  }

  const history = shipment.estimatedDeliveryHistory || [];
  const formattedCurrentDate = new Date(
    shipment.estimatedDeliveryDate,
  ).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  if (history.length === 0) {
    return <span className="text-slate-300">{formattedCurrentDate}</span>;
  }

  // Find the earliest recorded estimated delivery date
  const originalDate = history[0].date;
  const formattedOriginalDate = new Date(originalDate).toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
    },
  );

  return (
    <div className="relative flex items-center gap-1.5 group cursor-help">
      {/* Current Estimated Date */}
      <span className="text-white font-medium">{formattedCurrentDate}</span>

      {/* Drift/Change Indicator Icon */}
      <span className="text-amber-400 animate-pulse group-hover:text-amber-300 transition-colors">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        </svg>
      </span>

      {/* Tailwind Hover Tooltip (Invisible by default, reveals on Hover) */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col w-56 p-3 bg-slate-950 text-xs text-slate-200 rounded-lg shadow-xl border border-slate-700/80 z-50 pointer-events-none">
        <p className="font-bold text-amber-400 mb-1 flex items-center gap-1">
          ⚠️ Delivery Date Drifted
        </p>
        <p className="text-slate-300 leading-relaxed">
          Originally scheduled for{" "}
          <strong className="text-white">{formattedOriginalDate}</strong>.
        </p>
        <div className="border-t border-slate-800 my-1.5"></div>
        <p className="text-[10px] text-slate-500">
          Rescheduled {history.length} time{history.length > 1 ? "s" : ""} by
          carrier.
        </p>
        {/* Tooltip Chevron */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-slate-950"></div>
      </div>
    </div>
  );
};

export default function App() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  // --- NEW STATE: Form Controls ---
  const [newTracking, setNewTracking] = useState("");
  const [newCarrier, setNewCarrier] = useState("");
  const [newDirection, setNewDirection] = useState("Inbound");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState({ type: "", text: "" });

  // --- NEW STATE: Expandable Dropdowns ---
  const [expandedShipments, setExpandedShipments] = useState(new Set());

  const API_URL = import.meta.env.VITE_API_BASE_URL;

  // Endpoint saved in memory for adding tracking numbers
  const TRACK_API_URL =
    "https://zdecoujal6.execute-api.us-west-2.amazonaws.com/Prod/track";

  // Toggle expand/collapse state for a shipment
  const toggleRow = (trackingNumber) => {
    const newExpanded = new Set(expandedShipments);
    if (newExpanded.has(trackingNumber)) {
      newExpanded.delete(trackingNumber);
    } else {
      newExpanded.add(trackingNumber);
    }
    setExpandedShipments(newExpanded);
  };

  // --- EXTRACTED FETCH LOGIC ---
  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(API_URL);
      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }
      const data = await response.json();
      const sortedData = data.sort((a, b) => {
        const activeStatuses = ["IT", "EX", "AC", "OFD"];
        const isA_Active = activeStatuses.includes(a.statusCode);
        const isB_Active = activeStatuses.includes(b.statusCode);

        if (isA_Active && !isB_Active) return -1;
        if (!isA_Active && isB_Active) return 1;

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

        const dateA = a.actualDeliveryDate
          ? new Date(a.actualDeliveryDate)
          : null;
        const dateB = b.actualDeliveryDate
          ? new Date(b.actualDeliveryDate)
          : null;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateB - dateA;
      });
      setShipments(sortedData);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch shipments:", err);
      setError("Could not load shipments. Please check your API deployment.");
    } finally {
      setLoading(false);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  // --- NEW LOGIC: Add Shipment ---
  const handleAddShipment = async (e) => {
    e.preventDefault();
    if (!newTracking || !newCarrier) return;
    setIsSubmitting(true);
    setActionMessage({ type: "", text: "" });

    try {
      const response = await fetch(TRACK_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackingNumber: newTracking,
          carrier: newCarrier.toLowerCase(),
          direction: newDirection,
        }),
      });
      if (!response.ok) throw new Error("Failed to add tracking number");

      setActionMessage({
        type: "success",
        text: `Successfully added ${newTracking}`,
      });

      // Reset form
      setNewTracking("");
      setNewCarrier("");
      setNewDirection("Inbound");

      // Instantly refresh the table to show the new package
      await fetchShipments();

      // Clear success message after 3 seconds
      setTimeout(() => setActionMessage({ type: "", text: "" }), 3000);
    } catch (err) {
      setActionMessage({ type: "error", text: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const visibleShipments = showAll
    ? shipments
    : shipments.filter((shipment) => {
        if (shipment.statusCode === "DE") {
          const lastActivityTime = shipment.lastEventTimestamp
            ? new Date(shipment.lastEventTimestamp).getTime()
            : 0;
          const ageInMs = now - lastActivityTime;
          return ageInMs <= THREE_DAYS_MS;
        }
        return true;
      });

  const hasHiddenShipments = shipments.length > visibleShipments.length;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Where Is <span className="text-cyan-400">My Order?</span>
          </h1>
          <p className="mt-3 text-lg text-slate-400">
            Real-time inbound and outbound shipments
          </p>
        </header>

        {/* --- NEW UI: Control Panel --- */}
        <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700 mb-8 shadow-lg backdrop-blur-sm">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            {/* Add Shipment Form */}
            <form
              onSubmit={handleAddShipment}
              className="flex flex-wrap items-center gap-3 w-full md:w-auto"
            >
              <input
                type="text"
                placeholder="Tracking Number"
                value={newTracking}
                onChange={(e) => setNewTracking(e.target.value)}
                required
                className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              />
              <select
                value={newCarrier}
                onChange={(e) => setNewCarrier(e.target.value)}
                required
                className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="" disabled>
                  Select Carrier
                </option>
                <option value="fedex">FedEx</option>
                <option value="ups">UPS</option>
                <option value="stamps_com">USPS</option>
              </select>
              <select
                value={newDirection}
                onChange={(e) => setNewDirection(e.target.value)}
                className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="Inbound">Inbound</option>
                <option value="Outbound">Outbound</option>
              </select>
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors shadow-md"
              >
                {isSubmitting ? "Adding..." : "Add Shipment"}
              </button>
            </form>

            {/* Refresh Button */}
            <button
              onClick={fetchShipments}
              disabled={loading}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 px-4 py-2 rounded-lg text-sm font-semibold transition-colors border border-slate-600"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh Table
            </button>
          </div>

          {/* Action Messages */}
          {actionMessage.text && (
            <div
              className={`mt-4 text-sm px-4 py-2 rounded-md ${actionMessage.type === "error" ? "bg-rose-900/30 text-rose-400 border border-rose-800" : "bg-emerald-900/30 text-emerald-400 border border-emerald-800"}`}
            >
              {actionMessage.text}
            </div>
          )}
        </div>

        {/* Existing Content States */}
        {loading && shipments.length === 0 && (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
          </div>
        )}

        {error && (
          <div className="bg-rose-900/20 border-l-4 border-rose-500 p-4 rounded-md mb-8">
            <p className="text-sm text-rose-400">{error}</p>
          </div>
        )}

        {!loading && !error && shipments.length === 0 && (
          <div className="text-center py-20 bg-slate-800/50 rounded-xl shadow-lg border border-slate-700/50">
            <p className="text-lg text-slate-300">
              No tracked shipments found.
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Use the form above to register your first package.
            </p>
          </div>
        )}

        {!error && shipments.length > 0 && (
          <>
            <div className="bg-slate-800/40 rounded-xl shadow-2xl border border-slate-700 overflow-hidden backdrop-blur-sm relative">
              {loading && (
                <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-10 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-500"></div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-700/50">
                  <thead className="bg-slate-900/50">
                    <tr>
                      {/* Expansion Header Toggle Column */}
                      <th
                        scope="col"
                        className="w-12 px-4 py-4 text-center"
                      ></th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Carrier & Tracking
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Direction
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Status
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Shipped On
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Est. Delivery
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Delivered On
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Last Activity
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50 bg-transparent">
                    {visibleShipments.map((shipment) => {
                      const isExpanded = expandedShipments.has(
                        shipment.trackingNumber,
                      );
                      const sortedEvents = [...(shipment.events || [])].sort(
                        (a, b) =>
                          new Date(b.carrierOccurredAt) -
                          new Date(a.carrierOccurredAt),
                      );

                      return (
                        <React.Fragment key={shipment.trackingNumber}>
                          {/* Main Row */}
                          <tr
                            className={`hover:bg-slate-700/30 transition-colors ${isExpanded ? "bg-slate-800/30" : ""}`}
                          >
                            {/* Toggle Button Cell */}
                            <td className="px-4 py-4 whitespace-nowrap text-center text-sm font-medium">
                              <button
                                onClick={() =>
                                  toggleRow(shipment.trackingNumber)
                                }
                                className="text-slate-400 hover:text-cyan-400 transition-colors focus:outline-none"
                                aria-label={
                                  isExpanded
                                    ? "Collapse History"
                                    : "Expand History"
                                }
                              >
                                {isExpanded ? (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-5 w-5"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                ) : (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-5 w-5"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                )}
                              </button>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-semibold text-white tracking-wide">
                                {shipment.trackingNumber}
                              </div>
                              <div className="text-xs text-slate-500 uppercase mt-0.5 font-medium tracking-wider">
                                {shipment.carrier}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-x-2 px-2.5 py-1 rounded-full text-xs font-medium border ${shipment.direction === "Inbound" ? "bg-blue-900/30 text-blue-400 border-blue-800/50" : "bg-purple-900/30 text-purple-400 border-purple-800/50"}`}
                              >
                                {shipment.direction === "Inbound" ? (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 w-4"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                  >
                                    <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                                  </svg>
                                ) : (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 w-4"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                  >
                                    <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                                    <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v5.05a2.5 2.5 0 014.9 0H19a1 1 0 001-1V8a1 1 0 00-1-1h-5z" />
                                  </svg>
                                )}
                                {shipment.direction}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wide ${getStatusStyle(shipment.statusCode)}`}
                              >
                                {shipment.statusDescription}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                              {shipment.shipDate
                                ? new Date(
                                    shipment.shipDate,
                                  ).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                  })
                                : "—"}
                            </td>
                            {/* --- UPDATED CELL: Injected EstimatedDeliveryWithHistory --- */}
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                              <EstimatedDeliveryWithHistory
                                shipment={shipment}
                              />
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                              {shipment.actualDeliveryDate
                                ? new Date(
                                    shipment.actualDeliveryDate,
                                  ).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                  })
                                : "—"}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                              {shipment.lastEventTimestamp
                                ? timeSince(shipment.lastEventTimestamp)
                                : "No events recorded"}
                            </td>
                          </tr>

                          {/* Expandable Shipment Event History Row */}
                          {isExpanded && (
                            <tr className="bg-slate-900/60 border-t border-b border-slate-800/80">
                              <td colSpan={8} className="px-8 py-5">
                                <div className="border border-slate-700/60 rounded-xl overflow-hidden bg-slate-900 shadow-inner">
                                  <div className="bg-slate-800/40 px-5 py-3 border-b border-slate-700/60 flex justify-between items-center">
                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                      Tracking Events & Timeline
                                    </h4>
                                    <span className="text-xs text-slate-500 font-medium">
                                      Total events: {sortedEvents.length}
                                    </span>
                                  </div>
                                  {sortedEvents.length > 0 ? (
                                    <table className="min-w-full divide-y divide-slate-800 text-sm">
                                      <thead className="bg-slate-950/40">
                                        <tr>
                                          <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Occurred At
                                          </th>
                                          <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Description
                                          </th>
                                          <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Location
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-800 bg-transparent">
                                        {sortedEvents.map((event, index) => {
                                          const location = [
                                            event.cityLocality,
                                            event.stateProvince,
                                          ]
                                            .filter(Boolean)
                                            .join(", ");
                                          return (
                                            <tr
                                              key={index}
                                              className="hover:bg-slate-800/20 transition-colors"
                                            >
                                              <td className="px-5 py-3 whitespace-nowrap text-slate-400 font-mono text-xs">
                                                {new Date(
                                                  event.carrierOccurredAt,
                                                ).toLocaleString()}
                                              </td>
                                              <td className="px-5 py-3 text-slate-200 font-medium text-xs">
                                                {event.description}
                                              </td>
                                              <td className="px-5 py-3 text-slate-400 text-xs italic">
                                                {location || "In Transit"}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <div className="p-6 text-center text-sm text-slate-500 italic">
                                      No events recorded yet.
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {(hasHiddenShipments || showAll) && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full text-sm font-semibold transition-all border border-slate-700 shadow-md flex items-center gap-2"
                >
                  {showAll ? "Hide Older Deliveries" : "Show All Deliveries"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
