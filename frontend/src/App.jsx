import React, { useEffect, useState } from "react";
import { timeSince } from "./utils/timeUtils";

// A helper function to get the correct Tailwind classes for status codes.
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

export default function App() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const API_URL = import.meta.env.VITE_API_BASE_URL;

  useEffect(() => {
    async function fetchShipments() {
      try {
        setLoading(true);
        const response = await fetch(API_URL);
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        const data = await response.json();

        // Sort shipments by last event timestamp, most recent first
        const sortedData = data.sort(
          (a, b) =>
            new Date(b.lastEventTimestamp) - new Date(a.lastEventTimestamp),
        );

        setShipments(sortedData);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch shipments:", err);
        setError("Could not load shipments. Please check your API deployment.");
      } finally {
        setLoading(false);
      }
    }

    fetchShipments();
  }, [API_URL]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Midnight <span className="text-cyan-400">Dispatch</span>
          </h1>
          <p className="mt-3 text-lg text-slate-400">
            Real-time inbound and outbound shipment logistics.
          </p>
        </header>

        {/* Content States */}
        {loading && (
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
              Use the POST API to register your first package.
            </p>
          </div>
        )}

        {/* Shipments Table */}
        {!loading && !error && shipments.length > 0 && (
          <div className="bg-slate-800/40 rounded-xl shadow-2xl border border-slate-700 overflow-hidden backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-700/50">
                <thead className="bg-slate-900/50">
                  <tr>
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
                      Est. Delivery
                    </th>
                    {/* NEW COLUMN */}
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
                  {shipments.map((shipment) => (
                    <tr
                      key={shipment.trackingNumber}
                      className="hover:bg-slate-700/30 transition-colors"
                    >
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
                          className={`inline-flex items-center gap-x-2 px-2.5 py-1 rounded-full text-xs font-medium border ${
                            shipment.direction === "inbound"
                              ? "bg-blue-900/30 text-blue-400 border-blue-800/50"
                              : "bg-purple-900/30 text-purple-400 border-purple-800/50"
                          }`}
                        >
                          {/* UPDATED ICONS */}
                          {shipment.direction === "inbound" ? (
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
                        {shipment.estimatedDeliveryDate
                          ? new Date(
                              shipment.estimatedDeliveryDate,
                            ).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })
                          : "N/A"}
                      </td>
                      {/* NEW DATA CELL */}
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
