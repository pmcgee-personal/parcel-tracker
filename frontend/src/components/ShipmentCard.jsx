import React from "react";
import PropTypes from "prop-types";
import { timeSince } from "../utils/timeUtils";
import {
  EstimatedDeliveryWithHistory,
  DeliveredOnWithDrift,
} from "../DriftIndicator";
import EventTimeline from "./EventTimeline";
import { ChevronDownIcon, ChevronRightIcon, HomeIcon, TruckIcon } from "./icons";

export default function ShipmentCard({
  shipment,
  isExpanded,
  onToggleExpand,
  getStatusStyle,
  getLabelGeneratedDate,
}) {
  const sortedEvents = [...(shipment.events || [])].sort(
    (a, b) =>
      new Date(b.carrierOccurredAt) - new Date(a.carrierOccurredAt)
  );

  return (
    <React.Fragment key={shipment.trackingNumber}>
      <tr
        className={`hover:bg-slate-700/30 transition-colors ${
          isExpanded ? "bg-slate-800/30" : ""
        }`}
      >
        {/* Expand Toggle */}
        <td className="px-4 py-4 whitespace-nowrap text-center text-sm font-medium">
          <button
            onClick={() => onToggleExpand(shipment.trackingNumber)}
            className="text-slate-400 hover:text-cyan-400 transition-colors focus:outline-none"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse shipment details" : "Expand shipment details"}
          >
            {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </button>
        </td>

        {/* Tracking Info */}
        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
          <div className="text-xs sm:text-sm font-semibold text-white tracking-wide break-all sm:break-normal">
            {shipment.trackingNumber}
          </div>
          <div className="text-xs text-slate-500 uppercase mt-0.5 font-medium tracking-wider">
            {shipment.carrier}{" "}
            {shipment.serviceLevel && (
              <span className="text-slate-400 normal-case italic text-[10px] sm:text-xs">
                — {shipment.serviceLevel}
              </span>
            )}
          </div>
        </td>

        {/* Direction */}
        <td className="hidden sm:table-cell px-6 py-4 whitespace-nowrap">
          <span
            className={`inline-flex items-center gap-x-2 px-2.5 py-1 rounded-full text-xs font-medium border ${
              shipment.direction === "Inbound"
                ? "bg-blue-900/30 text-blue-400 border-blue-800/50"
                : "bg-purple-900/30 text-purple-400 border-purple-800/50"
            }`}
            aria-label={`Shipment direction: ${shipment.direction}`}
          >
            {shipment.direction === "Inbound" ? <HomeIcon /> : <TruckIcon />}
            {shipment.direction}
          </span>
        </td>

        {/* Status */}
        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
          <span
            className={`inline-flex items-center px-2 sm:px-3 py-1 rounded-md text-[10px] sm:text-xs font-bold uppercase tracking-wide ${getStatusStyle(
              shipment.statusCode
            )}`}
            aria-label={`Status: ${shipment.statusDescription}`}
          >
            {shipment.statusDescription}
          </span>
        </td>

        {/* Est Delivery (Mobile + Desktop, With Drift Component) */}
        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-300">
          <EstimatedDeliveryWithHistory shipment={shipment} />
        </td>

        {/* Label Gen. */}
        <td className="hidden lg:table-cell px-6 py-4 whitespace-nowrap text-sm text-slate-300">
          {getLabelGeneratedDate(shipment) || "—"}
        </td>

        {/* Shipped On */}
        <td className="hidden md:table-cell px-6 py-4 whitespace-nowrap text-sm text-slate-300">
          {shipment.shipDate
            ? new Date(shipment.shipDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            : "—"}
        </td>

        {/* Delivered On (With Drift Component) */}
        <td className="hidden md:table-cell px-6 py-4 whitespace-nowrap text-sm text-slate-300">
          <DeliveredOnWithDrift shipment={shipment} />
        </td>

        {/* Last Activity */}
        <td className="hidden lg:table-cell px-6 py-4 whitespace-nowrap text-sm text-slate-400">
          {shipment.lastEventTimestamp
            ? timeSince(shipment.lastEventTimestamp)
            : "No events recorded"}
        </td>
      </tr>

      {/* Expanded History Row */}
      {isExpanded && (
        <tr className="bg-slate-900/60 border-t border-b border-slate-800/80">
          <td colSpan={9} className="px-8 py-5">
            <EventTimeline events={sortedEvents} />
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

ShipmentCard.propTypes = {
  shipment: PropTypes.shape({
    trackingNumber: PropTypes.string.isRequired,
    carrier: PropTypes.string.isRequired,
    serviceLevel: PropTypes.string,
    direction: PropTypes.oneOf(["Inbound", "Outbound"]).isRequired,
    statusCode: PropTypes.string.isRequired,
    statusDescription: PropTypes.string.isRequired,
    estimatedDeliveryDate: PropTypes.string,
    actualDeliveryDate: PropTypes.string,
    shipDate: PropTypes.string,
    lastEventTimestamp: PropTypes.string,
    events: PropTypes.arrayOf(
      PropTypes.shape({
        carrierOccurredAt: PropTypes.string.isRequired,
        description: PropTypes.string.isRequired,
        cityLocality: PropTypes.string,
        stateProvince: PropTypes.string,
        countryCode: PropTypes.string,
      })
    ),
    estimatedDeliveryHistory: PropTypes.arrayOf(
      PropTypes.shape({
        date: PropTypes.string.isRequired,
      })
    ),
  }).isRequired,
  isExpanded: PropTypes.bool.isRequired,
  onToggleExpand: PropTypes.func.isRequired,
  getStatusStyle: PropTypes.func.isRequired,
  getLabelGeneratedDate: PropTypes.func.isRequired,
};
