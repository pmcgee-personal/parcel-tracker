import React from "react";
import PropTypes from "prop-types";

export default function ShipmentForm({
  tracking,
  setTracking,
  carrier,
  setCarrier,
  direction,
  setDirection,
  serviceLevel,
  setServiceLevel,
  source,
  setSource,
  isSubmitting,
  isFormValid,
  onSubmit,
  loading,
  onRefresh,
  actionMessage,
}) {
  return (
    <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700 mb-8 shadow-lg backdrop-blur-sm">
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-end">
        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 flex-1"
        >
          <input
            type="text"
            placeholder="Tracking Number"
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            required
            className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
          />
          <select
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
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
          <input
            type="text"
            placeholder="Service Level"
            value={serviceLevel}
            onChange={(e) => setServiceLevel(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
          />
          <input
            type="text"
            placeholder="Source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
          />
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="Inbound">Inbound</option>
            <option value="Outbound">Outbound</option>
          </select>
          <button
            type="submit"
            disabled={isSubmitting || !isFormValid}
            className="sm:col-span-2 lg:col-auto bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors shadow-md whitespace-nowrap"
          >
            {isSubmitting ? "Adding..." : "Add Shipment"}
          </button>
        </form>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="w-full lg:w-auto flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 px-4 py-2 rounded-lg text-sm font-semibold transition-colors border border-slate-600"
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

      {actionMessage.text && (
        <div
          className={`mt-4 text-sm px-4 py-2 rounded-md ${
            actionMessage.type === "error"
              ? "bg-rose-900/30 text-rose-400 border border-rose-800"
              : "bg-emerald-900/30 text-emerald-400 border border-emerald-800"
          }`}
        >
          {actionMessage.text}
        </div>
      )}
    </div>
  );
}

ShipmentForm.propTypes = {
  tracking: PropTypes.string.isRequired,
  setTracking: PropTypes.func.isRequired,
  carrier: PropTypes.string.isRequired,
  setCarrier: PropTypes.func.isRequired,
  direction: PropTypes.string.isRequired,
  setDirection: PropTypes.func.isRequired,
  serviceLevel: PropTypes.string.isRequired,
  setServiceLevel: PropTypes.func.isRequired,
  source: PropTypes.string.isRequired,
  setSource: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool.isRequired,
  isFormValid: PropTypes.bool.isRequired,
  onSubmit: PropTypes.func.isRequired,
  loading: PropTypes.bool.isRequired,
  onRefresh: PropTypes.func.isRequired,
  actionMessage: PropTypes.shape({
    type: PropTypes.string,
    text: PropTypes.string,
  }).isRequired,
};
