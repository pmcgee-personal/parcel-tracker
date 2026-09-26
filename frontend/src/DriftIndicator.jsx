import { useState } from "react";
import PropTypes from "prop-types";
import { AlertCircleIcon, ArrowDownIcon, ArrowUpIcon } from "./components/icons";
import { filterHistoryExcludingDate } from "./utils/shipmentHelpers";

// Shared pill + hover/click tooltip used by every drift indicator below.
// Owns its own open/closed state so callers just describe what to show.
const DriftBadge = ({
  formattedDate,
  iconColor,
  titleColor,
  driftText,
  IconSVG,
  ariaLabel,
  body,
  footer,
  pulse = false,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative flex items-center gap-1.5">
      <span className="text-white font-medium">{formattedDate}</span>
      <button
        onClick={() => setShowTooltip((v) => !v)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`${iconColor} ${pulse ? "animate-pulse" : ""} transition-colors cursor-pointer hover:opacity-80 p-1 rounded`}
        aria-label={ariaLabel}
        aria-expanded={showTooltip}
      >
        {IconSVG}
      </button>
      {showTooltip && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 flex flex-col w-56 p-3 bg-slate-950 text-xs text-slate-200 rounded-lg shadow-xl border border-slate-700/80 z-50 whitespace-normal break-words">
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
          <p className="text-slate-300 leading-relaxed">{body}</p>
          {footer && (
            <>
              <div className="border-t border-slate-800 my-1.5"></div>
              <p className="text-[10px] text-slate-500">{footer}</p>
            </>
          )}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-transparent border-b-slate-950"></div>
        </div>
      )}
    </div>
  );
};

DriftBadge.propTypes = {
  formattedDate: PropTypes.string.isRequired,
  iconColor: PropTypes.string.isRequired,
  titleColor: PropTypes.string.isRequired,
  driftText: PropTypes.string.isRequired,
  IconSVG: PropTypes.node.isRequired,
  ariaLabel: PropTypes.string.isRequired,
  body: PropTypes.node.isRequired,
  footer: PropTypes.node,
  pulse: PropTypes.bool,
};

const ROSE = { iconColor: "text-rose-400 hover:text-rose-300", titleColor: "text-rose-400" };
const EMERALD = { iconColor: "text-emerald-400 hover:text-emerald-300", titleColor: "text-emerald-400" };
const AMBER = { iconColor: "text-amber-400 hover:text-amber-300", titleColor: "text-amber-400" };

export const EstimatedDeliveryWithHistory = ({ shipment }) => {
  if (!shipment.estimatedDeliveryDate) {
    return <span className="text-slate-500">—</span>;
  }

  const formattedCurrentDate = new Date(
    shipment.estimatedDeliveryDate,
  ).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  const currentTimestamp = new Date(shipment.estimatedDeliveryDate).setHours(
    0,
    0,
    0,
    0,
  );

  // The estimate itself has slipped into the past with no delivery scan yet.
  // This fires independent of estimatedDeliveryHistory, so it catches any
  // carrier that goes quiet mid-transit and never sends an updated EDD at
  // all -- there's nothing to diff against history, but the promised date
  // has already come and gone.
  const isOverdue =
    !shipment.actualDeliveryDate &&
    currentTimestamp < new Date().setHours(0, 0, 0, 0);

  const filteredHistory = filterHistoryExcludingDate(
    shipment.estimatedDeliveryHistory,
    shipment.estimatedDeliveryDate,
  );

  if (filteredHistory.length === 0) {
    if (!isOverdue) {
      return <span className="text-slate-300">{formattedCurrentDate}</span>;
    }
    return (
      <DriftBadge
        formattedDate={formattedCurrentDate}
        iconColor={ROSE.iconColor}
        titleColor={ROSE.titleColor}
        driftText="Delivery Delayed"
        IconSVG={<ArrowDownIcon />}
        ariaLabel={`Delivery Delayed: estimate of ${formattedCurrentDate} has passed`}
        body="Estimated delivery date has passed with no new update."
        pulse
      />
    );
  }

  const originalDate = filteredHistory[0].date;
  const formattedOriginalDate = new Date(originalDate).toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
    },
  );

  const originalTimestamp = new Date(originalDate).setHours(0, 0, 0, 0);

  let { iconColor, titleColor } = AMBER;
  let driftText = "Date Changed";
  let IconSVG = <AlertCircleIcon />;

  if (currentTimestamp > originalTimestamp) {
    ({ iconColor, titleColor } = ROSE);
    driftText = "Delivery Delayed";
    IconSVG = <ArrowDownIcon />;
  } else if (currentTimestamp < originalTimestamp) {
    ({ iconColor, titleColor } = EMERALD);
    driftText = "Arriving Early";
    IconSVG = <ArrowUpIcon />;
  }

  // Being overdue trumps whatever the history diff alone implied (even a
  // date that was pulled in earlier, or that only changed format, is a
  // delay once it's actually passed with nothing delivered).
  if (isOverdue) {
    ({ iconColor, titleColor } = ROSE);
    driftText = "Delivery Delayed";
    IconSVG = <ArrowDownIcon />;
  }

  return (
    <DriftBadge
      formattedDate={formattedCurrentDate}
      iconColor={iconColor}
      titleColor={titleColor}
      driftText={driftText}
      IconSVG={IconSVG}
      ariaLabel={`${driftText}: ${formattedOriginalDate}`}
      body={
        <>
          Originally scheduled for{" "}
          <strong className="text-white">{formattedOriginalDate}</strong>.
        </>
      }
      footer={`Rescheduled ${filteredHistory.length} time${
        filteredHistory.length > 1 ? "s" : ""
      } by carrier.`}
      pulse
    />
  );
};

export const DeliveredOnWithDrift = ({ shipment }) => {
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
          ...ROSE,
          driftText: "Delivered Late",
          IconSVG: <ArrowDownIcon />,
        }
      : {
          ...EMERALD,
          driftText: "Delivered Early",
          IconSVG: <ArrowUpIcon />,
        };

  return (
    <DriftBadge
      formattedDate={formattedActualDate}
      iconColor={iconColor}
      titleColor={titleColor}
      driftText={driftText}
      IconSVG={IconSVG}
      ariaLabel={`${driftText}: ${formattedOriginalDate}`}
      body={
        <>
          Originally expected on{" "}
          <strong className="text-white">{formattedOriginalDate}</strong>.
        </>
      }
    />
  );
};

EstimatedDeliveryWithHistory.propTypes = {
  shipment: PropTypes.shape({
    estimatedDeliveryDate: PropTypes.string,
    actualDeliveryDate: PropTypes.string,
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
