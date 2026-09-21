import { useState } from "react";
import PropTypes from "prop-types";
import { AlertCircleIcon, ArrowDownIcon, ArrowUpIcon } from "./components/icons";
import { filterHistoryExcludingDate } from "./utils/shipmentHelpers";

export const EstimatedDeliveryWithHistory = ({ shipment }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!shipment.estimatedDeliveryDate) {
    return <span className="text-slate-500">—</span>;
  }

  const filteredHistory = filterHistoryExcludingDate(
    shipment.estimatedDeliveryHistory,
    shipment.estimatedDeliveryDate,
  );

  const formattedCurrentDate = new Date(
    shipment.estimatedDeliveryDate,
  ).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  if (filteredHistory.length === 0) {
    return <span className="text-slate-300">{formattedCurrentDate}</span>;
  }

  const originalDate = filteredHistory[0].date;
  const formattedOriginalDate = new Date(originalDate).toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
    },
  );

  const currentTimestamp = new Date(shipment.estimatedDeliveryDate).setHours(
    0,
    0,
    0,
    0,
  );
  const originalTimestamp = new Date(originalDate).setHours(0, 0, 0, 0);

  let iconColor = "text-amber-400 hover:text-amber-300";
  let titleColor = "text-amber-400";
  let driftText = "Date Changed";
  let IconSVG = <AlertCircleIcon />;

  if (currentTimestamp > originalTimestamp) {
    iconColor = "text-rose-400 hover:text-rose-300";
    titleColor = "text-rose-400";
    driftText = "Delivery Delayed";
    IconSVG = <ArrowDownIcon />;
  } else if (currentTimestamp < originalTimestamp) {
    iconColor = "text-emerald-400 hover:text-emerald-300";
    titleColor = "text-emerald-400";
    driftText = "Arriving Early";
    IconSVG = <ArrowUpIcon />;
  }

  return (
    <div className="relative flex items-center gap-1.5">
      <span className="text-white font-medium">{formattedCurrentDate}</span>
      <button
        onClick={() => setShowTooltip(!showTooltip)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`${iconColor} animate-pulse transition-colors cursor-pointer hover:opacity-80 p-1 rounded`}
        aria-label={`${driftText}: ${formattedOriginalDate}`}
        aria-expanded={showTooltip}
      >
        {IconSVG}
      </button>
      {showTooltip && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 flex flex-col w-56 p-3 bg-slate-950 text-xs text-slate-200 rounded-lg shadow-xl border border-slate-700/80 z-50">
          <button
            onClick={() => setShowTooltip(false)}
            className="absolute top-1 right-1 text-slate-500 hover:text-slate-300 text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
          <p className={`font-bold ${titleColor} mb-1 flex items-center gap-1`}>
            {driftText}
          </p>
          <p className="text-slate-300 leading-relaxed">
            Originally scheduled for{" "}
            <strong className="text-white">{formattedOriginalDate}</strong>.
          </p>
          <div className="border-t border-slate-800 my-1.5"></div>
          <p className="text-[10px] text-slate-500">
            Rescheduled {filteredHistory.length} time
            {filteredHistory.length > 1 ? "s" : ""} by carrier.
          </p>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-transparent border-b-slate-950"></div>
        </div>
      )}
    </div>
  );
};

export const DeliveredOnWithDrift = ({ shipment }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!shipment.actualDeliveryDate) {
    return <span className="text-slate-500">—</span>;
  }

  const formattedActualDate = new Date(
    shipment.actualDeliveryDate,
  ).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  const history = shipment.estimatedDeliveryHistory || [];

  if (!shipment.estimatedDeliveryDate && history.length === 0) {
    return <span className="text-slate-300">{formattedActualDate}</span>;
  }

  const originalEdd = shipment.estimatedDeliveryDate
    ? (() => {
        const filteredHistory = filterHistoryExcludingDate(
          history,
          shipment.estimatedDeliveryDate,
        );
        return filteredHistory.length > 0
          ? filteredHistory[0].date
          : shipment.estimatedDeliveryDate;
      })()
    : history[0].date;

  if (!originalEdd) {
    return <span className="text-slate-300">{formattedActualDate}</span>;
  }

  const actualTimestamp = new Date(shipment.actualDeliveryDate).setHours(
    0,
    0,
    0,
    0,
  );
  const originalTimestamp = new Date(originalEdd).setHours(0, 0, 0, 0);

  if (actualTimestamp === originalTimestamp) {
    return <span className="text-slate-300">{formattedActualDate}</span>;
  }

  const formattedOriginalDate = new Date(originalEdd).toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
    },
  );

  const { iconColor, titleColor, driftText, IconSVG } =
    actualTimestamp > originalTimestamp
      ? {
          iconColor: "text-rose-400 hover:text-rose-300",
          titleColor: "text-rose-400",
          driftText: "Delivered Late",
          IconSVG: <ArrowDownIcon />,
        }
      : {
          iconColor: "text-emerald-400 hover:text-emerald-300",
          titleColor: "text-emerald-400",
          driftText: "Delivered Early",
          IconSVG: <ArrowUpIcon />,
        };

  return (
    <div className="relative flex items-center gap-1.5">
      <span className="text-white font-medium">{formattedActualDate}</span>
      <button
        onClick={() => setShowTooltip(!showTooltip)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`${iconColor} transition-colors cursor-pointer hover:opacity-80 p-1 rounded`}
        aria-label={`${driftText}: ${formattedOriginalDate}`}
        aria-expanded={showTooltip}
      >
        {IconSVG}
      </button>
      {showTooltip && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 flex flex-col w-56 p-3 bg-slate-950 text-xs text-slate-200 rounded-lg shadow-xl border border-slate-700/80 z-50">
          <button
            onClick={() => setShowTooltip(false)}
            className="absolute top-1 right-1 text-slate-500 hover:text-slate-300 text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
          <p className={`font-bold ${titleColor} mb-1 flex items-center gap-1`}>
            {driftText}
          </p>
          <p className="text-slate-300 leading-relaxed">
            Originally expected on{" "}
            <strong className="text-white">{formattedOriginalDate}</strong>.
          </p>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-transparent border-b-slate-950"></div>
        </div>
      )}
    </div>
  );
};

EstimatedDeliveryWithHistory.propTypes = {
  shipment: PropTypes.shape({
    estimatedDeliveryDate: PropTypes.string,
    estimatedDeliveryHistory: PropTypes.arrayOf(
      PropTypes.shape({
        date: PropTypes.string.isRequired,
      })
    ),
  }).isRequired,
};

DeliveredOnWithDrift.propTypes = {
  shipment: PropTypes.shape({
    actualDeliveryDate: PropTypes.string,
    estimatedDeliveryDate: PropTypes.string,
    estimatedDeliveryHistory: PropTypes.arrayOf(
      PropTypes.shape({
        date: PropTypes.string.isRequired,
      })
    ),
  }).isRequired,
};
