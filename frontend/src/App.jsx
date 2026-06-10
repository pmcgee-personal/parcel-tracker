import React, { useEffect, useState } from "react";
import { timeSince } from "./utils/timeUtils";

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
        setShipments(data);
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
    <div className="min-h-screen bg-slate-50 text-slate-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            📦 Parcel Tracker
          </h1>
          <p className="mt-3 text-lg text-slate-500">
            Real-time inbound and outbound shipment logistics.
          </p>
        </header>

        {/* Content States */}
        {loading && (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md mb-8">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {!loading && !error && shipments.length === 0 && (
          <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-slate-100">
            <p className="text-lg text-slate-500">
              No tracked shipments found.
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Use the POST API to register your first package.
            </p>
          </div>
        )}

        {/* Shipments Table */}
        {!loading && !error && shipments.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider"
                    >
                      Carrier & Tracking
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider"
                    >
                      Direction
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider"
                    >
                      Status
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider"
                    >
                      Est. Delivery
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider"
                    >
                      Last Activity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {shipments.map((shipment) => (
                    <tr
                      key={shipment.trackingNumber}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-semibold text-slate-900">
                          {shipment.trackingNumber}
                        </div>
                        <div className="text-xs text-slate-500 uppercase">
                          {shipment.carrier}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            shipment.direction === "inbound"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-teal-50 text-teal-700"
                          }`}
                        >
                          {shipment.direction === "inbound"
                            ? "⬇ Inbound"
                            : "⬆ Outbound"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-slate-900 font-medium">
                          {shipment.statusDescription}
                        </div>
                        <div className="text-xs text-slate-500">
                          Code: {shipment.statusCode}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                        {shipment.estimatedDeliveryDate
                          ? new Date(
                              shipment.estimatedDeliveryDate,
                            ).toLocaleDateString()
                          : "N/A"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
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
