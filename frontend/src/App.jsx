import React, { useEffect, useState, useCallback } from "react";
import ShipmentForm from "./components/ShipmentForm";
import ShipmentCard from "./components/ShipmentCard";
import { getStatusStyle, getLabelGeneratedDate } from "./utils/shipmentHelpers";
import {
  sanitizeTrackingNumber,
  sanitizeCarrier,
  sanitizeTextField,
} from "./utils/sanitize";
import { sortShipments } from "./utils/sortShipments";

export default function App() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  // Form Controls
  const [newTracking, setNewTracking] = useState("");
  const [newCarrier, setNewCarrier] = useState("");
  const [newDirection, setNewDirection] = useState("Inbound");
  const [newServiceLevel, setNewServiceLevel] = useState("");
  const [newSource, setNewSource] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState({ type: "", text: "" });

  // Expandable Dropdowns
  const [expandedShipments, setExpandedShipments] = useState(new Set());

  // Pagination state
  const [nextToken, setNextToken] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const API_URL = import.meta.env.VITE_API_BASE_URL;
  const API_KEY = import.meta.env.VITE_API_KEY;

  const toggleRow = (trackingNumber) => {
    const newExpanded = new Set(expandedShipments);
    if (newExpanded.has(trackingNumber)) {
      newExpanded.delete(trackingNumber);
    } else {
      newExpanded.add(trackingNumber);
    }
    setExpandedShipments(newExpanded);
  };

  const fetchShipments = useCallback(
    async (token = null, isLoadMore = false) => {
      try {
        setLoading(true);
        const url = new URL(API_URL);
        url.searchParams.set("limit", "50");
        if (token) {
          url.searchParams.set("nextToken", token);
        }

        const response = await fetch(url.toString(), {
          headers: { "x-api-key": API_KEY },
        });
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }

        const responseData = await response.json();

        // Handle both old array format and new paginated format
        const shipmentList = Array.isArray(responseData)
          ? responseData
          : responseData.shipments || [];
        const pagination = responseData.pagination || null;

        // Sort shipments using the canonical sorting function
        const sortedData = sortShipments(shipmentList);

        if (isLoadMore) {
          // Combine with existing shipments and re-sort the entire list
          // to maintain correct order across paginated results
          setShipments((prev) => sortShipments([...prev, ...sortedData]));
        } else {
          setShipments(sortedData);
        }

        setNextToken(pagination?.nextToken || null);
        setHasMore(pagination?.hasMore || false);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch shipments:", err);
        setError("Could not load shipments. Please check your API deployment.");
      } finally {
        setLoading(false);
      }
    },
    [API_URL, API_KEY],
  );

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  const validateForm = (tracking = newTracking, carrier = newCarrier) => {
    // Sanitize inputs first
    const sanitizedTracking = sanitizeTrackingNumber(tracking);
    const sanitizedCarrier = sanitizeCarrier(carrier);

    if (!sanitizedTracking) {
      return { valid: false, error: "Tracking number is required" };
    }

    if (sanitizedTracking.length < 3) {
      return {
        valid: false,
        error: "Tracking number must be at least 3 characters",
      };
    }

    if (!sanitizedCarrier) {
      return { valid: false, error: "Carrier selection is required" };
    }

    const sanitizedServiceLevel = sanitizeTextField(newServiceLevel, 100);
    if (sanitizedServiceLevel.length > 100) {
      return { valid: false, error: "Service level is too long" };
    }

    const sanitizedSource = sanitizeTextField(newSource, 100);
    if (sanitizedSource.length > 100) {
      return { valid: false, error: "Source is too long" };
    }

    return { valid: true };
  };

  const isFormValid = validateForm().valid;

  const handleAddShipment = async (e) => {
    e.preventDefault();

    const validation = validateForm();
    if (!validation.valid) {
      setActionMessage({ type: "error", text: validation.error });
      return;
    }

    setIsSubmitting(true);
    setActionMessage({ type: "", text: "" });

    try {
      // Sanitize all inputs before sending to API
      const sanitizedTracking = sanitizeTrackingNumber(newTracking);
      const sanitizedCarrier = sanitizeCarrier(newCarrier);
      const sanitizedServiceLevel = sanitizeTextField(newServiceLevel, 100);
      const sanitizedSource = sanitizeTextField(newSource, 100);

      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify({
          trackingNumber: sanitizedTracking,
          carrier: sanitizedCarrier,
          direction: newDirection,
          serviceLevel: sanitizedServiceLevel,
          source: sanitizedSource,
        }),
      });

      if (!response.ok) throw new Error("Failed to add tracking number");

      setActionMessage({
        type: "success",
        text: `Successfully added ${sanitizedTracking}`,
      });

      setNewTracking("");
      setNewCarrier("");
      setNewDirection("Inbound");
      setNewServiceLevel("");
      setNewSource("");
      await fetchShipments();
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
          return now - lastActivityTime <= THREE_DAYS_MS;
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

        {/* Control Panel */}
        <ShipmentForm
          tracking={newTracking}
          setTracking={setNewTracking}
          carrier={newCarrier}
          setCarrier={setNewCarrier}
          direction={newDirection}
          setDirection={setNewDirection}
          serviceLevel={newServiceLevel}
          setServiceLevel={setNewServiceLevel}
          source={newSource}
          setSource={setNewSource}
          isSubmitting={isSubmitting}
          isFormValid={isFormValid}
          onSubmit={handleAddShipment}
          loading={loading}
          onRefresh={fetchShipments}
          actionMessage={actionMessage}
        />

        {/* Load/Error/Empty States */}
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

        {/* Main Table */}
        {!error && shipments.length > 0 && (
          <>
            <div className="bg-slate-800/40 rounded-xl shadow-2xl border border-slate-700 overflow-hidden backdrop-blur-sm relative">
              {loading && (
                <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-10 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-500"></div>
                </div>
              )}
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <table className="min-w-full divide-y divide-slate-700/50 text-sm sm:text-base">
                  <thead className="bg-slate-900/50">
                    <tr>
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
                        className="hidden sm:table-cell px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
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
                        className="hidden lg:table-cell px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Label Gen.
                      </th>
                      <th
                        scope="col"
                        className="hidden md:table-cell px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Shipped On
                      </th>
                      <th
                        scope="col"
                        className="hidden sm:table-cell px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Est. Delivery
                      </th>
                      <th
                        scope="col"
                        className="hidden md:table-cell px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Delivered On
                      </th>
                      <th
                        scope="col"
                        className="hidden lg:table-cell px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                      >
                        Last Activity
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50 bg-transparent">
                    {visibleShipments.map((shipment) => (
                      <ShipmentCard
                        key={shipment.trackingNumber}
                        shipment={shipment}
                        isExpanded={expandedShipments.has(
                          shipment.trackingNumber
                        )}
                        onToggleExpand={toggleRow}
                        getStatusStyle={getStatusStyle}
                        getLabelGeneratedDate={getLabelGeneratedDate}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination Controls */}
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center items-center">
              {/* Load More Button (Server-side pagination) */}
              {hasMore && (
                <button
                  onClick={() => fetchShipments(nextToken, true)}
                  disabled={loading}
                  className="px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full text-sm font-semibold transition-all border border-cyan-600 shadow-md flex items-center gap-2"
                >
                  Load More Shipments
                </button>
              )}

              {/* Show All Deliveries Toggle (Client-side filtering) */}
              {hasHiddenShipments && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full text-sm font-semibold transition-all border border-slate-700 shadow-md flex items-center gap-2"
                >
                  {showAll ? "Hide Older Deliveries" : "Show All Deliveries"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
